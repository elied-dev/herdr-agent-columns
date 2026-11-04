#!/usr/bin/env python3
"""Usage report for the agent-columns Usage dialog, modeled on T3 Code's Usage page.

Prints one JSON object: subscription limits per provider (Claude, Codex, GitHub Copilot) and token
totals per agent and model from local transcripts (Pi, Claude Code, Codex) over the last N days.
Usage: usage.py [days]
"""
import glob, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 7
NOW = time.time()
SINCE = NOW - DAYS * 86400


def ts(value):
    """ISO string or epoch (s/ms) -> epoch seconds, or None."""
    if isinstance(value, (int, float)):
        return value / 1000 if value > 1e12 else value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def n(value):
    return value if isinstance(value, (int, float)) and value > 0 else 0


# ---------- limits (T3 Code: claudeUsageLimits.ts, codexUsageLimits.ts) ----------

def curl_json(url, headers):
    # curl, not urllib: it trusts the macOS keychain (corporate CAs included).
    args = ["curl", "-sS", "-m", "15", "-w", "\n%{http_code}", url]
    for k, v in headers.items():
        args += ["-H", f"{k}: {v}"]
    out = subprocess.run(args, capture_output=True, text=True, timeout=20).stdout
    body, _, code = out.rpartition("\n")
    if not code.startswith("2"):
        raise RuntimeError(f"HTTP {code or 'error'}")
    return json.loads(body)


def window(id, label, used, resets_at=None, mins=None):
    return {"id": id, "label": label, "usedPercent": max(0, min(100, float(used))),
            "resetsAt": ts(resets_at), "windowMins": mins}


def claude_limits():
    try:
        raw = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                             capture_output=True, text=True, timeout=10).stdout
        oauth = json.loads(raw or "{}").get("claudeAiOauth") or {}
    except Exception:
        oauth = {}
    if not oauth.get("accessToken"):
        path = os.path.join(HOME, ".claude", ".credentials.json")
        if os.path.exists(path):
            oauth = json.load(open(path)).get("claudeAiOauth") or {}
    token = oauth.get("accessToken")
    if not token:
        return None
    acct = {"provider": "claude", "label": "Claude", "plan": oauth.get("subscriptionType"), "windows": []}
    try:
        u = curl_json("https://api.anthropic.com/api/oauth/usage", {
            "Authorization": f"Bearer {token}", "anthropic-beta": "oauth-2025-04-20",
            # The endpoint can return 429 without a Claude Code user agent.
            "User-Agent": "claude-code/2.1.273"})
        for key, label, mins in (("five_hour", "Session", 300), ("seven_day", "Weekly", 10080)):
            w = u.get(key)
            if w and isinstance(w.get("utilization"), (int, float)):
                acct["windows"].append(window(key, label, w["utilization"], w.get("resets_at"), mins))
        for key, label in (("seven_day_opus", "Weekly · Opus"), ("seven_day_sonnet", "Weekly · Sonnet")):
            w = u.get(key)
            if w and isinstance(w.get("utilization"), (int, float)):
                acct["windows"].append(window(key, label, w["utilization"], w.get("resets_at"), 10080))
        extra = u.get("extra_usage") or {}
        if extra.get("is_enabled") and n(extra.get("monthly_limit")):
            acct["windows"].append(window("monthly_spend", "Monthly spend",
                                          100 * n(extra.get("used_credits")) / extra["monthly_limit"]))
    except Exception as e:
        acct["error"] = str(e)
    return acct


def codex_limits():
    path = os.path.join(os.environ.get("CODEX_HOME", os.path.join(HOME, ".codex")), "auth.json")
    try:
        tokens = json.load(open(path)).get("tokens") or {}
    except Exception:
        return None
    if not tokens.get("access_token"):
        return None
    acct = {"provider": "codex", "label": "Codex", "plan": None, "windows": []}
    headers = {"Authorization": f"Bearer {tokens['access_token']}", "User-Agent": "codex-cli"}
    if tokens.get("account_id"):
        headers["ChatGPT-Account-Id"] = tokens["account_id"]
    try:
        u = curl_json("https://chatgpt.com/backend-api/wham/usage", headers)
        acct["plan"] = u.get("plan_type")
        rl = u.get("rate_limit") or {}
        monthly = acct["plan"] in ("free", "go")
        for key, fallback in (("primary_window", 43200 if monthly else 300), ("secondary_window", 10080)):
            w = rl.get(key)
            if not w or not isinstance(w.get("used_percent"), (int, float)):
                continue
            mins = (w.get("limit_window_seconds") or fallback * 60) / 60
            label = "Monthly" if mins >= 43200 else "Weekly" if mins >= 10080 else "Session"
            acct["windows"].append(window(key, label, w["used_percent"], w.get("reset_at"), mins))
    except Exception as e:
        acct["error"] = str(e)
    return acct


def copilot_limits():
    # Not in T3 Code: Pi's github-copilot login (its refresh token is the GitHub OAuth token).
    try:
        token = json.load(open(os.path.join(HOME, ".pi", "agent", "auth.json")))["github-copilot"]["refresh"]
    except Exception:
        return None
    acct = {"provider": "copilot", "label": "GitHub Copilot", "plan": None, "windows": []}
    try:
        u = curl_json("https://api.github.com/copilot_internal/user", {
            "Authorization": f"token {token}", "Accept": "application/json", "Editor-Version": "vscode/1.99.0"})
        acct["plan"] = u.get("copilot_plan")
        reset = u.get("quota_reset_date_utc") or u.get("quota_reset_date")
        for key, label in (("premium_interactions", "Premium requests"), ("chat", "Chat")):
            q = (u.get("quota_snapshots") or {}).get(key)
            if not q:
                continue
            if q.get("unlimited"):
                used = q.get("credits_used")
                acct["windows"].append({"id": key, "label": label, "unlimited": True, "resetsAt": ts(reset),
                                        "note": f"{used:,} credits used" if used else None})
            elif isinstance(q.get("percent_remaining"), (int, float)):
                w = window(key, label, 100 - q["percent_remaining"], reset, 43200)
                if q.get("entitlement"):
                    w["note"] = f"{q['entitlement'] - n(q.get('remaining')):,.0f} / {q['entitlement']:,.0f}"
                acct["windows"].append(w)
    except Exception as e:
        acct["error"] = str(e)
    return acct


# ---------- transcripts (T3 Code: provider-pi usage.ts, claudeUsage.ts, codexUsage.ts) ----------

totals = {}  # agent -> {"models": {model: bucket}, "days": {date: tokens}}
seen = set()


def add(agent, model, t, inp, cached, write, out, reasoning=0, cost=0.0):
    if t is None or t < SINCE:
        return
    a = totals.setdefault(agent, {"models": {}, "days": {}})
    m = a["models"].setdefault(model, {"input": 0, "cached": 0, "cacheWrite": 0, "output": 0,
                                       "reasoning": 0, "cost": 0.0, "requests": 0})
    m["input"] += inp; m["cached"] += cached; m["cacheWrite"] += write
    m["output"] += out; m["reasoning"] += reasoning; m["cost"] += cost; m["requests"] += 1
    day = datetime.fromtimestamp(t).strftime("%Y-%m-%d")
    a["days"][day] = a["days"].get(day, 0) + inp + cached + write + out


def recent(pattern):
    for path in glob.glob(pattern, recursive=True):
        try:
            if os.path.getmtime(path) >= SINCE:
                yield path
        except OSError:
            pass


def scan_pi():
    root = os.environ.get("PI_CODING_AGENT_SESSION_DIR") or os.path.join(
        os.environ.get("PI_CODING_AGENT_DIR") or os.path.join(HOME, ".pi", "agent"), "sessions")
    for path in recent(os.path.join(root, "**", "*.jsonl")):
        with open(path, errors="replace") as f:
            for line in f:
                if '"usage"' not in line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                src = e.get("message") if e.get("type") == "message" else e
                if not isinstance(src, dict) or not isinstance(src.get("usage"), dict):
                    continue
                if e.get("type") == "message" and src.get("role") not in ("assistant", "toolResult"):
                    continue
                model = f"{src['provider']}/{src.get('responseModel') or src.get('model')}" if src.get("provider") else "Tools/summaries"
                # Forks copy entries with the same id and timestamp; count each once.
                key = ("pi", e.get("id"), e.get("timestamp"), model)
                if key in seen:
                    continue
                seen.add(key)
                u = src["usage"]
                cost = (u.get("cost") or {}).get("total") if isinstance(u.get("cost"), dict) else 0
                add("pi", model, ts(e.get("timestamp")), n(u.get("input")), n(u.get("cacheRead")),
                    n(u.get("cacheWrite")), n(u.get("output")), n(u.get("reasoning")), n(cost))


def scan_claude():
    root = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude")
    for path in recent(os.path.join(root, "projects", "**", "*.jsonl")):
        with open(path, errors="replace") as f:
            for line in f:
                if '"usage"' not in line or '"assistant"' not in line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                msg = e.get("message") or {}
                u = msg.get("usage")
                model = msg.get("model") or ""
                if e.get("type") != "assistant" or not isinstance(u, dict) or not model or model == "<synthetic>":
                    continue
                # Every content block repeats its message's usage; keep the first.
                key = ("claude", msg.get("id"), e.get("requestId"))
                if key != ("claude", None, None):
                    if key in seen:
                        continue
                    seen.add(key)
                add("claude", model, ts(e.get("timestamp")), n(u.get("input_tokens")),
                    n(u.get("cache_read_input_tokens")), n(u.get("cache_creation_input_tokens")),
                    n(u.get("output_tokens")), 0, n(e.get("costUSD")))


def scan_codex():
    # shortcut: sums each token_count's last_token_usage and skips T3 Code's fork/interrupt reconciliation;
    # port codexUsage.ts if Codex totals look off.
    root = os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
    for path in recent(os.path.join(root, "sessions", "**", "*.jsonl")):
        model, last = "codex", None
        with open(path, errors="replace") as f:
            for line in f:
                if '"turn_context"' not in line and '"token_count"' not in line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                p = e.get("payload") or {}
                if e.get("type") == "turn_context" and p.get("model"):
                    model = p["model"]
                elif p.get("type") == "token_count":
                    info = p.get("info") or {}
                    u, total = info.get("last_token_usage"), json.dumps(info.get("total_token_usage"))
                    if not isinstance(u, dict) or (total != "null" and total == last):
                        continue
                    last = total
                    cached = n(u.get("cached_input_tokens"))
                    add("codex", model, ts(e.get("timestamp")), max(0, n(u.get("input_tokens")) - cached),
                        cached, 0, n(u.get("output_tokens")), n(u.get("reasoning_output_tokens")))


with ThreadPoolExecutor() as pool:
    limits = [pool.submit(f) for f in (claude_limits, codex_limits, copilot_limits)]
    for scan in (scan_pi, scan_claude, scan_codex):
        try:
            scan()
        except Exception as e:
            print(f"{scan.__name__}: {e}", file=sys.stderr)
    limits = [f.result() for f in limits]

json.dump({"checkedAt": NOW, "days": DAYS, "limits": [l for l in limits if l], "agents": totals}, sys.stdout)

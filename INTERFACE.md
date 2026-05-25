# Prototype Interface: Low-Cost Assistant I/O

*Addendum to PLAN.md â€” defer the Even Realities G2 purchase until the system proves its value.*

---

## Philosophy

Don't spend $850 on glasses to test an assistant that doesn't exist yet. Simulate the experience with hardware you already own. Buy the G2 when you know exactly what you want pushed to your eyes.

## Recommended Starting Setup

**Hardware:** iPhone + any Bluetooth earbuds with a mic (AirPods or whatever you have).

**Notification channel:** Pushover ($5 one-time, dead-simple HTTP API, supports Apple Watch complications) or ntfy (free, self-hosted, open source). Your server pushes notifications with priority levels straight to your phone lock screen.

**Voice I/O channel:** Telegram bot. You already need this for quick-capture. Talk into Telegram via earbuds (native voice message support), bot receives audio, transcribes via Whisper API, processes through assistant, replies as text in the same chat. One app, one channel, works on day one.

**Optional alternative â€” Siri Shortcut:** A shortcut called "Hey assistant" that records audio, hits your server's API, and speaks the response via text-to-speech. Triggered by "Hey Siri, assistant" or AirPod tap. No app needed.

**Optional hardware upgrades (cheap):**
- Used Apple Watch SE/Series 5 ($80-120): Glanceable wrist display for notifications. Telegram has a native watch app with voice message support. Closest analog to the G2 HUD experience.
- Bluetooth push-to-talk button ($10-15): Clip-on shutter remote reprogrammed via iOS Shortcuts to trigger voice capture. Physical "talk to assistant" button without saying "Hey Siri" in public.

## Key Search Queries for Implementation

- `"Telegram bot voice message webhook Python"` â€” receiving and processing voice input
- `"Pushover API send notification from server"` â€” one-line curl to push alerts
- `"ntfy self-hosted push notifications iPhone"` â€” free Pushover alternative
- `"Siri Shortcut record audio send to API endpoint"` â€” voice capture via Siri
- `"iOS Shortcuts whisper API transcription"` â€” server-side transcription option

## Upgrade Trigger

Buy the Even Realities G2 + R1 ring when all three are true:
1. The assistant is running and producing daily value.
2. You're consistently annoyed by pulling out your phone to read notifications.
3. You have a clear picture of what notification types belong on a HUD vs. phone vs. desktop.

## Cost Comparison

| Setup | Cost |
|---|---|
| Earbuds you own + Telegram + Pushover | $0-5 |
| Add used Apple Watch | $80-120 |
| Add Bluetooth button | $10-15 |
| **Prototype total** | **$5-140** |
| Even Realities G2 + R1 ring | ~$850 |

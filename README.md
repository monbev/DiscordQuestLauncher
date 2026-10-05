# DiscordQuestLauncher

A BetterDiscord plugin for accepted Discord quests, progress tracking, quest filters and new quest notifications.

**Development version 1.1.0-dev.** English interface. Quest names follow Discord's language. Stable update checks are disabled in this feature build.

## Features

- Play/Pause controls on the Quests page.
- Accept new button for loaded quest cards with a direct native Accept action.
- One video quest and one game/stream/activity quest run in parallel, sequentially within each queue.
- All / New / In progress / Rewards filters. New excludes Launch Quest tasks.
- Confirmed progress plus an estimated bar and timer updated every second.
- Inline execution panel below the acceptance controls, with quest names, Play/Pause, visible states and expandable errors.
- Approximate total remaining time in minutes.
- Top-right new quest notifications with sound, countdown, snooze and dismissal.
- Notifications wait while Discord is hidden; existing countdowns pause.
- An attributed plugin tip in Discord's Reward Error dialog.

Use Accept new for direct acceptance, or accept quests manually. Claim rewards manually.

## Installation

1. Use BetterDiscord with the official Discord desktop client.
2. Download `DiscordQuestLauncher.plugin.js` using GitHub's Raw download. Save the JavaScript file, not the GitHub page.
3. Open Discord Settings → BetterDiscord → Plugins → Open Plugins Folder.
4. Copy the file into that folder and enable the plugin.
5. Open Quests, accept supported quests, then press Play.

On Windows the usual plugins folder is `%APPDATA%\BetterDiscord\plugins`.

No build tools, extra scripts or libraries are required. The plugin file contains its source.

## Updates

Starting with 1.0.1, the plugin checks its public GitHub file on enable and every four hours. A newer version produces a standard BetterDiscord notification with **Update** and **Later** buttons. Update replaces the plugin file without creating a backup. If quests are active, installation waits until that run ends or is paused. Later dismisses the notification for this plugin session; it can appear again after restart.

Users of 1.0.0 must install 1.0.1 manually once to receive future update notifications. Updates require access to GitHub and a BetterDiscord version supporting `BdApi.Net.fetch` and `BdApi.UI.showNotification`. Download manually if these are unavailable.

## Usage

**Accept new**, below the quest filters, processes only visible New cards matching the plugin and Discord filters. Set the filters first, then press Accept new. Loaded cards below the viewport count; cards hidden by any filter do not. Native Accept buttons are clicked sequentially. Video cards with Watch are opened and their video dialog is closed using its native Close button, then enrollment is checked. Already accepted, completed, expired, unsupported and Launch Quest tasks are excluded. Platform selection and other manual steps are skipped. If an unrelated dialog opens, the video cannot be closed safely, or acceptance remains unconfirmed for 12 seconds, the batch stops; check Discord before retrying. The result reports confirmed acceptances and detected manual steps. No quest execution starts automatically. Acceptance is unavailable during an active execution run or when the plugin filter is In progress or Rewards.

Play starts all accepted, incomplete, unexpired supported quests. The selected filter affects displayed cards, not the execution queue.

Pause stops local work and restores patched game/stream functions. Requests already sent may finish. Play again starts a fresh queue using Discord's current progress.

Supported tasks: `WATCH_VIDEO`, `WATCH_VIDEO_ON_MOBILE`, `PLAY_ON_DESKTOP`, `STREAM_ON_DESKTOP` and `PLAY_ACTIVITY`. Desktop game quests require the official desktop client. Stream quests require manually sharing a window in a voice channel with another person present. Activity quests require an available private or voice channel.

The solid progress segment is confirmed by Discord. The lighter segment and `~` timer estimate progress between updates. Estimates can freeze while waiting for Discord and do not guarantee completion. Overall estimated time accounts for the two parallel queues.

## Notification settings

| Setting | Default |
| --- | --- |
| New quest check interval | 3 minutes / 180 seconds |
| Card display duration | 12 seconds |
| Snooze | 1 hour |
| Pause on hover/focus | On |
| Sound | On, volume 25% |
| Optional Windows notifications | Off |

Settings are available from the plugin's settings button. Saved custom timings are preserved when updating.

The check interval is displayed in minutes; card duration uses seconds and snooze uses hours. Notification switches and a separate Test sound button are available. Accept new shows the number of actionable visible New quests, or an explanation when no matching actions are available.

Checks read Discord's loaded quest data; they do not fetch a fresh list from the server. Checks run on enable, on returning to the visible window and at the configured interval. Changing this interval does not affect execution speed or the progress timer.

Existing quests are silently remembered on first use for an account. Newly detected supported, unaccepted, unexpired quests join one grouped card. Accepting or completing a quest removes it at the next check.

- **Snooze** postpones all new quest notifications, including future arrivals, and persists across restart. Eligible snoozed quests return afterward.
- **Dismiss current** and **×** suppress the current pending quests. Later quest IDs can notify.
- Click the notification body or **Open Quests** to open Discord's Quests page. Windows notification clicks use the same action and request focus for the Discord window. Filters remain unchanged. If internal routing is unavailable, a native quest link is tried; failures show a manual-navigation message.
- A card that expires automatically does not repeatedly notify about the same quests.
- Hidden-window arrivals remain pending and silent. Existing countdowns pause. Returning to Discord rechecks eligibility before display. Optional Windows notifications are also deferred with the card.
- Hover/focus pause keeps the card readable. Test notification previews the card and sound without changing quest history.

Checks require Discord to be open and the plugin enabled. Reward reminders are left to Discord.

## Troubleshooting

Hover over the Play/Pause control for a failed quest's error. If claiming a reward fails, try another Discord session, such as your browser or phone.

Avoid running other quest automation plugins or console scripts simultaneously: they can replace the same Discord functions.

Discord updates can break internal module discovery, requests or layout selectors. New quests with incomplete metadata can be missed by notification detection. Detection depends on Discord's loaded data, not an independent server monitor.

The execution code was verified in the maintainer's Windows desktop client. Automated notification and updater checks use simulated Discord data; compatibility with every quest or future client version is not guaranteed. This is an unofficial plugin.

## Privacy

No separate analytics or third-party notification service. The updater downloads the public plugin file from this GitHub repository to check versions, but installs it only after pressing Update. Sound is synthesized locally. Settings and notification history use BetterDiscord's local data storage. Quest execution sends requests through Discord's internal client API.

For bug reports, include the version, task type and sanitized error text. Do not publish your account configuration or full network logs.

## Credits and license

Quest algorithms are based on [Suraj64x/discordquest](https://github.com/Suraj64x/discordquest). BetterDiscord integration, controls, filters, progress and notifications were added for monbev. This is a modified derivative, not an official upstream release.

GPL-3.0, consistent with the upstream project's stated license. See [LICENSE](LICENSE).

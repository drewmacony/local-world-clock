# World Clock — Local Browser App

A modern, offline-capable world clock dashboard with a main digital clock, three configurable time-zone clocks, hourly chime, custom MP3 sounds, multiple alarms, light/dark modes, and local settings storage.

## Requirements

- A current version of Chrome, Edge, Firefox, or Safari.
- No internet connection is required for normal use after the project files are on your computer.
- The computer's operating system should have automatic date/time enabled for accurate time.

## Start the app

**Simplest method:** open `index.html` in your browser.

If your browser restricts some local-file audio or storage features, use a local-only server instead:

### Windows
1. Install Python 3 if it is not already installed.
2. Open Command Prompt in this folder.
3. Run `run-windows.bat`, or run:
   ```bat
   py -m http.server 8765 --bind 127.0.0.1
   ```
4. Visit `http://127.0.0.1:8765`.

### macOS
1. Open Terminal in this folder.
2. Run `chmod +x run-macos.command` once.
3. Run `./run-macos.command`, or run:
   ```sh
   python3 -m http.server 8765 --bind 127.0.0.1
   ```
4. Visit `http://127.0.0.1:8765`.

The local server binds to `127.0.0.1` only and is not exposed to your local network or the public internet. Keep the terminal window open while using it.

## Using the app

1. Click **Enable sound** once; browsers commonly require a user gesture before audio can play.
2. Open **Settings** to choose the main and three secondary IANA time zones, time format, and appearance.
3. Enable **Hourly chime** to play a short built-in chime on the hour. Upload an MP3 to replace it.
4. Click **Add alarm** to create a one-time, daily, or weekly alarm. You can choose a time zone, snooze duration, volume, and optional MP3.
5. Use **Export settings** to back up clock choices and alarm definitions. Imported settings do not include audio files; upload those again if needed.

Time zones use the browser's IANA time-zone database and automatically account for daylight-saving rules supported by that database.

## Time synchronization

The app reads the computer's current time through the browser. It does not independently synchronize with Apple or Microsoft servers.

- **Windows 11:** Settings → Time & language → Date & time → enable **Set time automatically**.
- **macOS:** System Settings → General → Date & Time → enable automatic time and date.

The operating system is responsible for synchronizing with its configured time service. If the system clock is wrong or automatic synchronization is disabled, this app will show the same incorrect system time.

## Important browser limitations

- This is a browser application, not a background system service.
- The page must remain open and the computer must be awake for alarms and hourly chimes to run. Browser throttling can delay them, particularly in background tabs.
- Alarms cannot reliably fire while the browser is closed or the PC is asleep. A native desktop app with OS scheduling is needed for that requirement.
- Audio playback may require clicking **Enable sound** first. If sound is muted by the operating system or browser, the app cannot override that.
- A one-time alarm is checked against the selected zone's local date and time. If the selected region skips that local time due to a daylight-saving transition, the alarm will not fire that day; if a time occurs twice, it fires only on the first matching minute.
- Browser storage can be cleared by the user or browser. Settings are stored in localStorage; uploaded MP3s are stored in IndexedDB on this computer and browser.
- Exported JSON contains settings and alarms but not uploaded MP3 audio.

## Files

- `index.html` — app structure and dialogs
- `styles.css` — responsive light/dark interface
- `app.js` — clocks, zones, audio, alarms, and persistence
- `run-windows.bat` — optional local server launcher
- `run-macos.command` — optional local server launcher

## Manual test checklist

- [ ] Main clock updates every second.
- [ ] Each world clock changes independently when its time zone is changed.
- [ ] Light, dark, and system appearance settings work.
- [ ] Chime can be enabled, disabled, previewed, and replaced with an MP3.
- [ ] One-time, daily, and weekly alarms can be created, edited, disabled, and deleted.
- [ ] Alarm snooze and dismissal work.
- [ ] Settings persist after reload.
- [ ] Export/import restores settings.
- [ ] With internet disconnected, clocks and saved settings still work.
- [ ] With the tab closed or computer asleep, alarms are not expected to fire.

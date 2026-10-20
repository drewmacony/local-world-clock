(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { mainZone: "Africa/Accra", zones: ["Europe/London","America/New_York","Asia/Tokyo"], format: "24", appearance: "system", chimeEnabled: false, chimeSource: "main", chimeVolume: 0.65, alarms: [] };
  const DB_NAME = "world-clock-local-db", DB_VERSION = 1, AUDIO_STORE = "audio";
  let settings = loadSettings();
  let db = null, soundEnabled = false, chimeBlob = null, currentAlarmAudioBlob = null;
  let currentAlarmAudioName = "", ringingAlarm = null, ringingAudio = null, snoozeTimeout = null;
  let editingAlarmAudioBlob = null, editingAlarmAudioName = "";
  const firedChimes = new Set(), firedAlarms = new Set();
  const player = $("audio-player");

  function loadSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("worldClockSettings") || "{}") }; }
    catch { return structuredClone(DEFAULTS); }
  }

function getCurrentTime() {
  if (
    settings.timeSource === "manual" &&
    Number.isFinite(settings.manualEpoch) &&
    Number.isFinite(settings.manualAnchor)
  ) {
    // Keep the manual clock moving forward normally.
    return new Date(
      settings.manualEpoch + (Date.now() - settings.manualAnchor)
    );
  }

  return new Date();
}

function toLocalDateTimeValue(date) {
  const pad = n => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function updateSyncStatus() {
  const automatic = settings.timeSource === "system";

  document.getElementById("auto-sync").checked = automatic;
  document.getElementById("manual-date-time").disabled = automatic;
  document.getElementById("apply-manual-time").disabled = automatic;

  document.getElementById("sync-status").textContent = automatic
    ? "Using your computer's system time."
    : "Using your manually adjusted application time.";
}



  function saveSettings() {
    localStorage.setItem("worldClockSettings", JSON.stringify(settings));
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB is unavailable"));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(AUDIO_STORE);
      request.onsuccess = () => { db = request.result; resolve(db); };
      request.onerror = () => reject(request.error);
    });
  }
  function dbPut(key, value) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Local audio storage is unavailable"));
      const tx = db.transaction(AUDIO_STORE, "readwrite");
      tx.objectStore(AUDIO_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function dbGet(key) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve(null);
      const req = db.transaction(AUDIO_STORE, "readonly").objectStore(AUDIO_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  function dbDelete(key) {
    return new Promise((resolve) => {
      if (!db) return resolve();
      const tx = db.transaction(AUDIO_STORE, "readwrite");
      tx.objectStore(AUDIO_STORE).delete(key);
      tx.oncomplete = resolve; tx.onerror = resolve;
    });
  }
  function validZone(zone) {
    if (!zone || typeof zone !== "string") return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date()); return true; } catch { return false; }
  }
  function zoneLabel(zone) {
    const city = zone.split("/").pop().replaceAll("_", " ");
    const region = zone.includes("/") ? zone.split("/")[0].replaceAll("_", " ") : "UTC";
    if (zone === "Africa/Accra") return "Accra, Ghana";
    if (zone === "Europe/London") return "London";
    if (zone === "America/New_York") return "New York";
    if (zone === "Asia/Tokyo") return "Tokyo";
    if (zone === "Etc/UTC" || zone === "UTC") return "UTC";
    return `${city} · ${region}`;
  }
  function dateParts(date, zone) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23", weekday:"short" }).formatToParts(date);
    const o = {}; parts.forEach(p => { if (p.type !== "literal") o[p.type] = p.value; });
    return { year:+o.year, month:+o.month, day:+o.day, hour:+o.hour, minute:+o.minute, second:+o.second, weekday:o.weekday };
  }
  function offsetLabel(date, zone) {
    const p = dateParts(date, zone);
    const asUTC = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const offset = Math.round((asUTC - Math.floor(date.getTime()/1000)*1000)/60000);
    const sign = offset >= 0 ? "+" : "−", abs = Math.abs(offset);
    return `UTC${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`;
  }
  function fmtTime(date, zone, seconds=true) {
    return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour:"2-digit", minute:"2-digit", ...(seconds ? {second:"2-digit"} : {}), hour12: settings.format === "12" }).format(date);
  }
  function setTheme() {
    let theme = settings.appearance;
    if (theme === "system") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    $("theme-toggle").textContent = theme === "dark" ? "☼" : "◐";
  }
  function renderSettings() {
    $("main-zone").value = settings.mainZone;
    $("time-format").value = settings.format;
    $("appearance").value = settings.appearance;
    settings.zones.forEach((z,i) => $("zone-"+i).value = z);
    $("chime-enabled").checked = settings.chimeEnabled;
    $("chime-source").value = settings.chimeSource;
    $("chime-volume").value = settings.chimeVolume;
    $("chime-volume-value").textContent = `${Math.round(settings.chimeVolume*100)}%`;
    setTheme();
  }
  function renderClock(date) {
    $("main-location-label").textContent = zoneLabel(settings.mainZone);
    const mainText = fmtTime(date, settings.mainZone);
    if (settings.format === "12") {
      const match = mainText.match(/\s?(AM|PM)/i);
      $("main-clock").textContent = mainText.replace(/\s?(AM|PM)/i, "");
      $("main-ampm").textContent = match ? match[1].toUpperCase() : "";
    } else { $("main-clock").textContent = mainText; $("main-ampm").textContent = ""; }
    $("main-date").textContent = new Intl.DateTimeFormat(undefined, { timeZone:settings.mainZone, weekday:"long", year:"numeric", month:"long", day:"numeric" }).format(date);
    $("main-zone-badge").textContent = `${settings.mainZone} · ${offsetLabel(date,settings.mainZone)}`;
    settings.zones.forEach((zone,i) => {
      const card = document.querySelector(`[data-clock="${i}"]`);
      card.querySelector(".world-label").textContent = zoneLabel(zone);
      card.querySelector(".world-time").textContent = fmtTime(date,zone);
      card.querySelector(".world-meta").textContent = `${zone} · ${offsetLabel(date,zone)}`;
    });
  }
  function buildTimezoneList() {
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = ["Africa/Accra","Europe/London","America/New_York","Asia/Tokyo","Etc/UTC"]; }
    ["UTC","Africa/Accra","Europe/London","America/New_York","Asia/Tokyo"].forEach(z => { if (!zones.includes(z)) zones.unshift(z); });
    $("timezone-list").innerHTML = [...new Set(zones)].map(z => `<option value="${escapeHtml(z)}">${escapeHtml(zoneLabel(z))}</option>`).join("");
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
  function zoneFromInput(id) {
    const value = $(id).value.trim();
    if (!validZone(value)) throw new Error(`“${value || "(empty)"}” is not a valid time zone. Choose a listed IANA time zone, such as Africa/Accra.`);
    return value;
  }
  function announce(message) { $("settings-message").textContent = message; }
  function showSoundStatus() {
    $("sound-status").textContent = soundEnabled ? "Sound enabled" : "Sound not enabled";
    $("sound-status").classList.toggle("ready", soundEnabled);
    $("sound-enable").textContent = soundEnabled ? "Sound enabled ✓" : "Enable sound";
  }
  async function enableSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      gain.gain.value = 0.0001; oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.start(); oscillator.stop(ctx.currentTime + 0.02);
      soundEnabled = true; showSoundStatus();
    } catch { alert("Sound could not be enabled. Check your browser's audio permissions."); }
  }
  function playBuiltInChime(volume=0.65) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      [0,0.24].forEach((delay,i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = i ? 1760 : 1320;
        gain.gain.setValueAtTime(0.0001,now+delay);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001,volume*0.18),now+delay+0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001,now+delay+0.22);
        osc.connect(gain); gain.connect(ctx.destination); osc.start(now+delay); osc.stop(now+delay+0.24);
      });
      setTimeout(() => ctx.close(), 800);
    } catch {}
  }
  async function playBlob(blob, volume=0.8, loop=false) {
    if (!soundEnabled) { await enableSound(); }
    stopAudio();
    if (!blob) { playBuiltInChime(volume); return; }
    const url = URL.createObjectURL(blob);
    player.src = url; player.volume = Math.max(0,Math.min(1,volume)); player.loop = loop;
    try { await player.play(); } catch (e) { URL.revokeObjectURL(url); if (loop) playBuiltInChime(volume); }
    player.onended = () => { URL.revokeObjectURL(url); };
  }
  function stopAudio() {
    player.pause(); player.currentTime = 0; player.loop = false;
    if (ringingAudio) { ringingAudio.pause(); ringingAudio = null; }
  }
  async function getSound(key) { try { return await dbGet(key); } catch { return null; } }
  async function checkChime(now) {
    if (!settings.chimeEnabled) return;
    const zone = settings.chimeSource === "main" ? settings.mainZone : settings.zones[Number(settings.chimeSource)];
    const p = dateParts(now,zone);
    if (p.minute !== 0 || p.second !== 0) return;
    const key = `${zone}:${p.year}-${p.month}-${p.day}-${p.hour}`;
    if (firedChimes.has(key)) return;
    firedChimes.add(key);
    if (firedChimes.size > 12) firedChimes.clear();
    if (!soundEnabled) return;
    const blob = await getSound("hourly-chime");
    if (blob) playBlob(blob, Number(settings.chimeVolume), false); else playBuiltInChime(Number(settings.chimeVolume));
  }
  function weekdayNumber(shortName) { return ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[shortName]; }
  function alarmDue(alarm, now) {
    const p = dateParts(now,alarm.zone);
    const today = `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
    const hm = `${String(p.hour).padStart(2,"0")}:${String(p.minute).padStart(2,"0")}`;
    if (hm !== alarm.time || p.second !== 0) return false;
    if (alarm.repeat === "once") return today === alarm.date;
    if (alarm.repeat === "daily") return true;
    if (alarm.repeat === "weekly") return (alarm.days || []).includes(weekdayNumber(p.weekday));
    return false;
  }
  async function checkAlarms(now) {
    for (const alarm of settings.alarms) {
      if (!alarm.enabled) continue;
      if (alarmDue(alarm,now)) {
        const p = dateParts(now,alarm.zone);
        const key = `${alarm.id}:${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}`;
        if (firedAlarms.has(key)) continue;
        firedAlarms.add(key);
        if (firedAlarms.size > 100) firedAlarms.clear();
        triggerAlarm(alarm);
      }
    }
  }
  async function triggerAlarm(alarm) {
    if (ringingAlarm) return;
    ringingAlarm = alarm;
    $("ring-title").textContent = alarm.name;
    $("ring-subtitle").textContent = `${alarm.time} · ${alarm.zone}`;
    if (typeof $("ring-dialog").showModal === "function") $("ring-dialog").showModal();
    const blob = alarm.audioKey ? await getSound(alarm.audioKey) : await getSound("alarm-default");
    if (soundEnabled) await playBlob(blob, Number(alarm.volume ?? 0.8), true);
    else $("ring-subtitle").textContent += " · Click Enable sound to hear audio";
  }
  function getNextOccurrence(alarm) {
    const now = new Date();
    for (let i=0;i<370*24*60;i++) {
      const d = new Date(now.getTime()+i*60000);
      if (alarmDue(alarm,d)) return d;
    }
    return null;
  }
  function describeRepeat(alarm) {
    if (alarm.repeat === "once") return `Once · ${alarm.date} · ${alarm.zone}`;
    if (alarm.repeat === "daily") return `Every day · ${alarm.zone}`;
    const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return `${(alarm.days||[]).slice().sort((a,b)=>a-b).map(d=>names[d]).join(", ") || "No days selected"} · ${alarm.zone}`;
  }
  function renderAlarms() {
    const list = $("alarm-list");
    if (!settings.alarms.length) { list.innerHTML = '<div class="empty-state">No alarms yet. Add one to get started.</div>'; return; }
    list.innerHTML = settings.alarms.map(a => {
      const next = a.enabled ? getNextOccurrence(a) : null;
      const nextText = a.enabled ? (next ? `Next: ${new Intl.DateTimeFormat(undefined,{timeZone:a.zone,weekday:"short",month:"short",day:"numeric"}).format(next)}` : "No upcoming occurrence") : "Disabled";
      return `<div class="alarm-item ${a.enabled ? "" : "disabled"}" data-alarm-id="${escapeHtml(a.id)}">
        <div class="alarm-time">${escapeHtml(a.time)}</div><div class="alarm-info"><strong>${escapeHtml(a.name)}</strong><small>${escapeHtml(describeRepeat(a))}</small><small>${escapeHtml(nextText)}</small></div>
        <div class="alarm-actions"><button type="button" data-action="toggle" title="${a.enabled?"Disable":"Enable"} alarm" aria-label="${a.enabled?"Disable":"Enable"} ${escapeHtml(a.name)}">${a.enabled?"●":"○"}</button><button type="button" data-action="edit" title="Edit alarm" aria-label="Edit ${escapeHtml(a.name)}">✎</button><button type="button" data-action="delete" title="Delete alarm" aria-label="Delete ${escapeHtml(a.name)}">×</button></div></div>`;
    }).join("");
  }
  function openAlarm(alarm=null) {
    $("alarm-form").reset();
    $("alarm-form-error").textContent = "";
    $("alarm-id").value = alarm?.id || "";
    $("alarm-dialog-title").textContent = alarm ? "Edit alarm" : "Add alarm";
    $("alarm-name").value = alarm?.name || "";
    $("alarm-time").value = alarm?.time || "07:00";
    $("alarm-zone").value = alarm?.zone || settings.mainZone;
    $("alarm-repeat").value = alarm?.repeat || "once";
    $("alarm-date").value = alarm?.date || new Date().toISOString().slice(0,10);
    $("alarm-snooze").value = String(alarm?.snooze ?? 5);
    $("alarm-volume").value = String(alarm?.volume ?? 0.8);
    document.querySelectorAll("#weekday-wrap input").forEach(c => c.checked = (alarm?.days || []).includes(Number(c.value)));
    editingAlarmAudioBlob = null; editingAlarmAudioName = "";
    $("alarm-audio-label").textContent = alarm?.audioName || "Use default alarm sound";
    $("alarm-audio-file").value = "";
    currentAlarmAudioBlob = null; currentAlarmAudioName = alarm?.audioName || "";
    $("clear-alarm-audio").dataset.clear = "false";
    updateRepeatFields();
    $("alarm-dialog").showModal();
  }
  function updateRepeatFields() {
    const repeat = $("alarm-repeat").value;
    $("alarm-date-wrap").hidden = repeat !== "once";
    $("alarm-date").required = repeat === "once";
    $("weekday-wrap").hidden = repeat !== "weekly";
  }
  async function saveAlarm(event) {
    event.preventDefault();
    try {
      const id = $("alarm-id").value || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      const zone = zoneFromInput("alarm-zone");
      const repeat = $("alarm-repeat").value;
      const days = [...document.querySelectorAll("#weekday-wrap input:checked")].map(c=>Number(c.value));
      if (repeat === "weekly" && !days.length) throw new Error("Select at least one day for a weekly alarm.");
      const old = settings.alarms.find(a=>a.id===id);
      let audioKey = old?.audioKey || "";
      let audioName = old?.audioName || "";
      if ($("clear-alarm-audio").dataset.clear === "true") {
        if (audioKey) await dbDelete(audioKey);
        audioKey = ""; audioName = "";
      }
      if (editingAlarmAudioBlob) {
        audioKey = `alarm-${id}`;
        await dbPut(audioKey, editingAlarmAudioBlob);
        audioName = editingAlarmAudioName;
      }
      const alarm = { id, name:$("alarm-name").value.trim(), time:$("alarm-time").value, zone, repeat, date:$("alarm-date").value, days, snooze:Number($("alarm-snooze").value), volume:Number($("alarm-volume").value), enabled:old?.enabled ?? true, audioKey, audioName };
      if (!alarm.name || !alarm.time) throw new Error("Enter an alarm name and time.");
      settings.alarms = settings.alarms.filter(a=>a.id!==id).concat(alarm).sort((a,b)=>a.time.localeCompare(b.time));
      saveSettings(); renderAlarms(); $("alarm-dialog").close();
    } catch (err) { $("alarm-form-error").textContent = err.message; }
  }
  function closeRing() { stopAudio(); if ($("ring-dialog").open) $("ring-dialog").close(); ringingAlarm = null; }
  $("sound-enable").addEventListener("click", enableSound);
  $("theme-toggle").addEventListener("click",()=>{ settings.appearance = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; saveSettings(); renderSettings(); });
  $("open-settings").addEventListener("click",()=>{ $("settings-panel").hidden = false; $("settings-panel").scrollIntoView({behavior:"smooth",block:"start"}); });
  $("close-settings").addEventListener("click",()=>{ $("settings-panel").hidden = true; });
  ["main-zone","zone-0","zone-1","zone-2"].forEach(id => $(id).addEventListener("change",()=>{
    try {
      const zone = zoneFromInput(id);
      if (id==="main-zone") settings.mainZone=zone; else settings.zones[Number(id.slice(-1))]=zone;
      saveSettings(); renderSettings(); renderClock(new Date()); announce("Time zone saved.");
    } catch(e) { announce(e.message); $(id).value = id==="main-zone" ? settings.mainZone : settings.zones[Number(id.slice(-1))]; }
  }));
  document.querySelectorAll(".mini-edit").forEach(btn=>btn.addEventListener("click",()=>{ $("settings-panel").hidden=false; $("settings-panel").scrollIntoView({behavior:"smooth"}); const i=Number(btn.closest("[data-clock]").dataset.clock); $("zone-"+i).focus(); }));
  $("time-format").addEventListener("change",()=>{settings.format=$("time-format").value;saveSettings();renderClock(new Date());});
  $("appearance").addEventListener("change",()=>{settings.appearance=$("appearance").value;saveSettings();setTheme();});
  $("chime-enabled").addEventListener("change",()=>{settings.chimeEnabled=$("chime-enabled").checked;saveSettings();});
  $("chime-source").addEventListener("change",()=>{settings.chimeSource=$("chime-source").value;saveSettings();});
  $("chime-volume").addEventListener("input",()=>{settings.chimeVolume=Number($("chime-volume").value);$("chime-volume-value").textContent=`${Math.round(settings.chimeVolume*100)}%`;saveSettings();});
  $("chime-file").addEventListener("change",async e=>{
    const file=e.target.files[0]; if(!file)return;
    if (!file.name.toLowerCase().endsWith(".mp3") && file.type!=="audio/mpeg") { alert("Please choose an MP3 file."); e.target.value=""; return; }
    if (file.size > 20*1024*1024) { alert("Please choose an MP3 smaller than 20 MB."); e.target.value=""; return; }
    try { await dbPut("hourly-chime",file); $("chime-file-name").textContent=file.name; announce("Hourly chime saved locally."); }
    catch { alert("Could not save this file locally. Try a smaller MP3 or a browser with storage enabled."); }
  });
  $("preview-chime").addEventListener("click",async()=>{if(!soundEnabled)await enableSound();const blob=await getSound("hourly-chime");if(blob)await playBlob(blob,Number(settings.chimeVolume));else playBuiltInChime(Number(settings.chimeVolume));});
  $("add-alarm").addEventListener("click",()=>openAlarm());
  $("cancel-alarm").addEventListener("click",()=>$("alarm-dialog").close());
  $("cancel-alarm-x").addEventListener("click",()=>$("alarm-dialog").close());
  $("alarm-repeat").addEventListener("change",updateRepeatFields);
  $("alarm-form").addEventListener("submit",saveAlarm);
  $("alarm-audio-file").addEventListener("change",e=>{
    const file=e.target.files[0];if(!file)return;
    if(!file.name.toLowerCase().endsWith(".mp3")&&file.type!=="audio/mpeg"){alert("Please choose an MP3 file.");e.target.value="";return;}
    if(file.size>20*1024*1024){alert("Please choose an MP3 smaller than 20 MB.");e.target.value="";return;}
    editingAlarmAudioBlob=file;editingAlarmAudioName=file.name;$("alarm-audio-label").textContent=file.name;$("clear-alarm-audio").dataset.clear="false";
  });
  $("clear-alarm-audio").addEventListener("click",()=>{editingAlarmAudioBlob=null;editingAlarmAudioName="";currentAlarmAudioBlob=null;currentAlarmAudioName="";$("alarm-audio-label").textContent="Use default alarm sound";$("alarm-audio-file").value="";$("clear-alarm-audio").dataset.clear="true";});
  $("alarm-list").addEventListener("click",async e=>{
    const button=e.target.closest("button[data-action]");if(!button)return;
    const item=button.closest("[data-alarm-id]"), alarm=settings.alarms.find(a=>a.id===item.dataset.alarmId);if(!alarm)return;
    if(button.dataset.action==="toggle")alarm.enabled=!alarm.enabled;
    if(button.dataset.action==="edit"){openAlarm(alarm);return;}
    if(button.dataset.action==="delete"){if(confirm(`Delete "${alarm.name}"?`)){if(alarm.audioKey)await dbDelete(alarm.audioKey);settings.alarms=settings.alarms.filter(a=>a.id!==alarm.id);}}
    saveSettings();renderAlarms();
  });
  $("snooze-alarm").addEventListener("click",()=>{
    if(!ringingAlarm)return;
    const alarm=ringingAlarm, ms=Number(alarm.snooze||5)*60000;
    closeRing(); clearTimeout(snoozeTimeout);
    snoozeTimeout=setTimeout(()=>triggerAlarm({...alarm,name:`${alarm.name} (snoozed)`}),ms);
  });
  $("dismiss-alarm").addEventListener("click",closeRing);
  $("export-settings").addEventListener("click",()=>{
    const blob=new Blob([JSON.stringify(settings,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="world-clock-settings.json";a.click();URL.revokeObjectURL(url);announce("Settings exported. Uploaded audio files are not included in this export.");
  });
  $("import-settings").addEventListener("change",async e=>{
    const file=e.target.files[0];if(!file)return;
    try {
      const imported=JSON.parse(await file.text());
      if (!imported || !Array.isArray(imported.zones) || !Array.isArray(imported.alarms)) throw new Error("This does not look like a World Clock settings file.");
      if (!validZone(imported.mainZone) || imported.zones.length!==3 || imported.zones.some(z=>!validZone(z))) throw new Error("The file contains an invalid time zone.");
      settings={...DEFAULTS,...imported};saveSettings();renderSettings();renderClock(new Date());renderAlarms();announce("Settings imported. Audio files need to be uploaded again if they are missing.");
    } catch(err) { alert(`Could not import settings: ${err.message}`); } finally { e.target.value=""; }
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(settings.appearance==="system")setTheme();});

  async function init() {
    buildTimezoneList();
    try { await openDB(); } catch { announce("Audio storage is unavailable; clock and alarms still work, but uploaded sounds may not be saved."); }
    renderSettings();
    $("chime-file-name").textContent = await getSound("hourly-chime") ? "Custom MP3 saved" : "Built-in chime";
    // If the browser provides supported zone names, preserve a valid default. If a stored zone is invalid, fall back safely.
    if(!validZone(settings.mainZone))settings.mainZone=DEFAULTS.mainZone;
    settings.zones=settings.zones.map((z,i)=>validZone(z)?z:DEFAULTS.zones[i]);
    renderSettings(); renderClock(new Date()); renderAlarms(); showSoundStatus();
    const tick=async()=>{const now=new Date();renderClock(now);await checkChime(now);await checkAlarms(now);};
    await tick(); setInterval(tick,250);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden){renderClock(new Date());}});
  }
  init();



$("auto-sync").addEventListener("change", () => {
  if ($("auto-sync").checked) {
    settings.timeSource = "system";
    settings.manualEpoch = null;
    settings.manualAnchor = null;
  } else {
    // Start manual mode from the time currently displayed.
    const current = getCurrentTime();
    settings.timeSource = "manual";
    settings.manualEpoch = current.getTime();
    settings.manualAnchor = Date.now();
    $("manual-date-time").value = toLocalDateTimeValue(current);
  }

  saveSettings();
  updateSyncStatus();
  renderClock(getCurrentTime());
});

$("apply-manual-time").addEventListener("click", () => {
  const value = $("manual-date-time").value;

  if (!value) {
    alert("Please select a date and time.");
    return;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    alert("Please enter a valid date and time.");
    return;
  }

  settings.timeSource = "manual";
  settings.manualEpoch = timestamp;
  settings.manualAnchor = Date.now();

  saveSettings();
  updateSyncStatus();
  renderClock(getCurrentTime());

  alert("Application time updated successfully.");
});

})();
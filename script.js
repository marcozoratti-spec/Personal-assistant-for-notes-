// ========= BASIC CONFIG =========

// Change this to the IP or hostname of your ESP32 on your home Wi-Fi.
// Example: "http://192.168.1.50" or "http://esp32-study.local"
const ESP32_API_BASE = "http://192.168.1.50";

// If you want, you can use different endpoints on the ESP32 firmware.
const ENDPOINT_SYNC_NOTES = "/api/notes"; // POST notes JSON
const ENDPOINT_STATUS = "/api/status";    // GET device status (optional)

// ====== STATE ======
let notes = [];
const STORAGE_KEY = "smart_study_notes_v1";

// ====== CLOCK ======
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const d = now.toLocaleDateString([], {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  document.getElementById("clock-time").textContent = t;
  document.getElementById("clock-date").textContent = d;
}

// ====== LOCAL STORAGE ======
function loadNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      notes = [];
      return;
    }
    notes = JSON.parse(raw);
    if (!Array.isArray(notes)) notes = [];
  } catch (err) {
    console.error("Error loading notes", err);
    notes = [];
    document.getElementById("local-storage-status").textContent = "Local storage error";
    document.getElementById("local-storage-dot").classList.remove("ok");
  }
}

function saveNotes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (err) {
    console.error("Error saving notes", err);
    document.getElementById("local-storage-status").textContent = "Local storage full/error";
    document.getElementById("local-storage-dot").classList.remove("ok");
  }
}

// ====== RENDER NOTES ======
function renderNotes() {
  const list = document.getElementById("notes-list");
  list.innerHTML = "";

  if (notes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card-subtitle";
    empty.textContent = "No notes yet. Add one on the left.";
    list.appendChild(empty);
    return;
  }

  notes
    .slice()
    .sort((a, b) => {
      // sort by createdAt desc
      return (b.createdAt || 0) - (a.createdAt || 0);
    })
    .forEach((note, index) => {
      const item = document.createElement("div");
      item.className = "note-item";

      const main = document.createElement("div");
      main.className = "note-main";

      const text = document.createElement("div");
      text.className = "note-text";
      text.textContent = note.text;

      const badgesRight = document.createElement("div");
      badgesRight.style.display = "flex";
      badgesRight.style.flexDirection = "column";
      badgesRight.style.alignItems = "flex-end";
      badgesRight.style.gap = "4px";

      const subjectBadge = document.createElement("span");
      subjectBadge.className = "badge subject";
      subjectBadge.textContent = note.subject || "General";

      const priorityBadge = document.createElement("span");
      priorityBadge.className = "badge";
      priorityBadge.textContent = `Priority: ${note.priority || "normal"}`;

      badgesRight.appendChild(subjectBadge);
      badgesRight.appendChild(priorityBadge);

      main.appendChild(text);
      main.appendChild(badgesRight);
      item.appendChild(main);

      const meta = document.createElement("div");
      meta.className = "note-meta";

      const created = new Date(note.createdAt || Date.now());
      const createdStr = created.toLocaleString([], {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const createdSpan = document.createElement("span");
      createdSpan.textContent = `Created: ${createdStr}`;

      const dueSpan = document.createElement("span");
      dueSpan.className = "badge date";
      if (note.dueDate || note.dueTime) {
        dueSpan.textContent = `Due: ${note.dueDate || ""} ${note.dueTime || ""}`;
      } else {
        dueSpan.textContent = "Due: not set";
      }

      meta.appendChild(createdSpan);
      meta.appendChild(dueSpan);
      item.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "note-actions";

      const btnDelete = document.createElement("button");
      btnDelete.className = "tiny-btn";
      btnDelete.innerHTML = "🗑 Delete";
      btnDelete.addEventListener("click", () => {
        notes.splice(index, 1);
        saveNotes();
        renderNotes();
      });

      actions.appendChild(btnDelete);
      item.appendChild(actions);

      list.appendChild(item);
    });
}

// ====== CREATE NOTE ======
function createNoteFromForm() {
  const subject = document.getElementById("subject-select").value;
  const priority = document.getElementById("priority-select").value;
  const dueDate = document.getElementById("due-date").value;
  const dueTime = document.getElementById("due-time").value;
  const text = document.getElementById("note-text").value.trim();

  if (!text) {
    alert("Please write a note before saving.");
    return;
  }

  const note = {
    id: crypto.randomUUID ? crypto.randomUUID() : "note_" + Date.now(),
    subject,
    priority,
    dueDate: dueDate || null,
    dueTime: dueTime || null,
    text,
    createdAt: Date.now(),
  };

  notes.push(note);
  saveNotes();
  renderNotes();
  flashSyncStatus("Note saved locally", true);
}

// ====== CLEAR FORM ======
function clearForm() {
  document.getElementById("note-text").value = "";
  // keep subject and priority as they are for faster input in class
}

// ====== JSON EXPORT ======
function exportNotesAsJSON() {
  const dataStr = JSON.stringify({ notes }, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "study-notes.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ====== SYNC VIA WI-FI (HTTP REST to ESP32) ======
async function syncViaWifi() {
  const wifiDot = document.getElementById("wifi-dot");
  const wifiLabel = document.getElementById("wifi-status-label");
  const syncDot = document.getElementById("sync-status-dot");
  const syncLabel = document.getElementById("sync-status-label");

  wifiDot.classList.remove("ok");
  wifiLabel.textContent = "Wi-Fi: syncing...";

  syncDot.classList.remove("ok");
  syncLabel.textContent = "Sending notes to ESP32...";

  try {
    const res = await fetch(ESP32_API_BASE + ENDPOINT_SYNC_NOTES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      // You can change the shape here to match your ESP32 firmware
      body: JSON.stringify({ notes }),
    });

    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }

    wifiDot.classList.add("ok");
    wifiLabel.textContent = "Wi-Fi: synced with ESP32";

    syncDot.classList.add("ok");
    syncLabel.textContent = "Notes sent to ESP32 successfully";
  } catch (err) {
    console.error("Wi-Fi sync error:", err);
    wifiDot.classList.remove("ok");
    wifiLabel.textContent = "Wi-Fi: error contacting ESP32";

    syncDot.classList.remove("ok");
    syncLabel.textContent = "Sync failed: " + err.message;
  }
}

// ====== BLUETOOTH (Web Bluetooth skeleton) ======
// This is a template. You must fill in your ESP32 BLE service/characteristic UUIDs.
let btDevice = null;
let btServer = null;

async function connectBluetooth() {
  const btDot = document.getElementById("bt-dot");
  const btLabel = document.getElementById("bt-status-label");

  btDot.classList.remove("ok");
  btLabel.textContent = "Bluetooth: connecting...";

  if (!navigator.bluetooth) {
    alert("Web Bluetooth is not supported on this device/browser.");
    btLabel.textContent = "Bluetooth: not supported";
    return;
  }

  try {
    // Adapt filters to your ESP32 BLE name or service UUID
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        // example: filter by device name prefix
        { namePrefix: "StudyReminder" },
      ],
      optionalServices: ["0000ffe0-0000-1000-8000-00805f9b34fb"], // replace with your service UUID
    });

    btDevice = device;
    btServer = await btDevice.gatt.connect();

    btDot.classList.add("ok");
    btLabel.textContent = "Bluetooth: connected to " + (btDevice.name || "ESP32");

    // Example: write notes count to a characteristic (you must implement this in ESP32 firmware)
    // const service = await btServer.getPrimaryService("0000ffe0-0000-1000-8000-00805f9b34fb");
    // const characteristic = await service.getCharacteristic("0000ffe1-0000-1000-8000-00805f9b34fb");
    // const payload = new TextEncoder().encode(JSON.stringify({ count: notes.length }));
    // await characteristic.writeValue(payload);
  } catch (err) {
    console.error("Bluetooth error:", err);
    btDot.classList.remove("ok");
    btLabel.textContent = "Bluetooth: connection failed";
  }
}

// ====== CLEAR ALL NOTES ======
function clearAllNotes() {
  if (!confirm("Delete all notes? This cannot be undone.")) return;
  notes = [];
  saveNotes();
  renderNotes();
}

// ====== SYNC STATUS FLASH ======
function flashSyncStatus(message, ok) {
  const syncDot = document.getElementById("sync-status-dot");
  const syncLabel = document.getElementById("sync-status-label");

  if (ok) syncDot.classList.add("ok");
  else syncDot.classList.remove("ok");

  syncLabel.textContent = message;

  setTimeout(() => {
    if (notes.length === 0) {
      syncDot.classList.remove("ok");
      syncLabel.textContent = "Not synced with ESP32";
    }
  }, 2500);
}

// ====== INIT ======
function attachEvents() {
  document.getElementById("btn-save-note").addEventListener("click", createNoteFromForm);
  document.getElementById("btn-clear-form").addEventListener("click", clearForm);
  document.getElementById("btn-export-json").addEventListener("click", exportNotesAsJSON);

  document.getElementById("btn-sync-wifi").addEventListener("click", syncViaWifi);
  document.getElementById("btn-connect-bt").addEventListener("click", connectBluetooth);

  document.getElementById("btn-clear-notes").addEventListener("click", clearAllNotes);
}

function init() {
  loadNotes();
  renderNotes();
  attachEvents();
  updateClock();
  setInterval(updateClock, 1000);
}

document.addEventListener("DOMContentLoaded", init);

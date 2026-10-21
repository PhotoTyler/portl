// Discover page Easter eggs: the sky can be day, sunset or night.
//  - Tap the sun (or moon) 5 times quickly to move to the next time of day.
//  - Or type a Minecraft command in the search box: /time set day | sunset | night (also noon, midnight, 12000...).
(function () {
  var MODES = ["day", "sunset", "night"];
  var TICKS = { day: 1000, sunset: 12000, night: 13000 };
  var KEY = "portl-sky";
  var body = document.body;
  var sun = document.getElementById("sun");
  var search = document.getElementById("search");
  var toastTimer;

  function apply(mode, announce) {
    body.classList.remove("sunset", "night");
    if (mode !== "day") body.classList.add(mode);
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    if (announce) toast("Set the time to " + TICKS[mode]);
  }

  function current() {
    return body.classList.contains("night") ? "night" : body.classList.contains("sunset") ? "sunset" : "day";
  }

  function toast(text) {
    var t = document.getElementById("egg-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "egg-toast";
      t.setAttribute("role", "status");
      body.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = "0"; }, 2500);
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (MODES.indexOf(saved) > 0) apply(saved, false);

  var taps = 0, lastTap = 0;
  sun.addEventListener("click", function () {
    var now = Date.now();
    taps = now - lastTap < 1500 ? taps + 1 : 1;
    lastTap = now;
    if (taps >= 5) {
      taps = 0;
      apply(MODES[(MODES.indexOf(current()) + 1) % MODES.length], true);
    }
  });

  function fromCommand(text) {
    var m = /^\/time set (\w+)$/i.exec(text.trim());
    if (!m) return null;
    var v = m[1].toLowerCase();
    if (v === "day" || v === "noon" || v === "sunrise") return "day";
    if (v === "sunset") return "sunset";
    if (v === "night" || v === "midnight") return "night";
    if (/^\d+$/.test(v)) {
      var t = Number(v) % 24000;
      return t >= 13000 && t < 23000 ? "night" : t >= 11500 && t < 13000 ? "sunset" : "day";
    }
    return null;
  }

  if (search) {
    search.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var mode = fromCommand(search.value);
      if (!mode) return;
      e.preventDefault();
      apply(mode, true);
      search.value = "";
      search.dispatchEvent(new Event("input"));
    });
  }
})();

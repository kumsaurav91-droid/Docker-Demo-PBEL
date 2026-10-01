/* UpTrack — login.js: login + signup form */
(function () {
  var $ = function (s) { return document.querySelector(s); }, mode = "login";
  function setMode(m) {
    mode = m; var s = m === "signup";
    document.querySelectorAll(".auth-tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === m); });
    $("#g-name").hidden = !s; $("#g-conf").hidden = !s;
    $("#a-pass").autocomplete = s ? "new-password" : "current-password";
    $("#auth-submit").textContent = s ? "Create account" : "Log in";
    $("#auth-sub").textContent = s ? "Create your free account in seconds." : "Welcome back. Log in to your dashboard.";
    $("#auth-foot").innerHTML = s ? 'Already have an account? <a href="#" data-tab="login">Log in</a>' : 'New here? <a href="#" data-tab="signup">Create a free account</a>';
    err("");
  }
  function err(t) { var e = $("#auth-error"); e.textContent = t; e.classList.toggle("show", !!t); }
  document.addEventListener("click", function (e) { var t = e.target.closest("[data-tab]"); if (t) { e.preventDefault(); setMode(t.dataset.tab); } });
  if (/[?&]signup=1/.test(location.search)) setMode("signup");
  $("#auth-form").addEventListener("submit", function (e) {
    e.preventDefault(); err("");
    var email = $("#a-email").value.trim(), pass = $("#a-pass").value, body = { email: email, password: pass };
    if (!email || !pass) return err("Enter your email and password");
    if (mode === "signup") {
      body.name = $("#a-name").value.trim();
      if (body.name.length < 2) return err("Please enter your name");
      if (pass.length < 8) return err("Password must be at least 8 characters");
      if (pass !== $("#a-conf").value) return err("Passwords do not match");
    }
    var btn = $("#auth-submit"); btn.disabled = true;
    fetch("/api/auth/" + mode, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong"); try { localStorage.removeItem("uptrack:cleared"); } catch (e) {} location.href = "/"; }); })
      .catch(function (x) { err(x.message); btn.disabled = false; });
  });
  var demoBtn = $("#demo-btn");
  if (demoBtn) {
    demoBtn.addEventListener("click", function () {
      demoBtn.disabled = true; demoBtn.textContent = "Logging in...";
      fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Demo account unavailable"); try { localStorage.removeItem("uptrack:cleared"); } catch (e) {} location.href = "/dashboard.html"; }); })
        .catch(function (x) { err(x.message); demoBtn.disabled = false; demoBtn.textContent = "Log in with Demo Account"; });
    });
  }
})();

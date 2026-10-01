/* Landing page: uptime bars, theme toggle, mobile menu, scroll reveal */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  document.querySelectorAll(".bars").forEach(function (el) {
    var bad = (el.dataset.bad || "").split(",").filter(Boolean).map(Number), h = "";
    for (var i = 0; i < 40; i++) h += "<i" + (bad.indexOf(i) > -1 ? ' class="x"' : "") + "></i>";
    el.innerHTML = h;
  });
  $("#lp-theme").addEventListener("click", function () {
    var t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t; try { localStorage.setItem("uptrack:theme", t); } catch (e) {}
  });
  var b = $("#burger"), m = $("#lp-menu");
  b.addEventListener("click", function () { var o = m.classList.toggle("open"); b.setAttribute("aria-expanded", o); });
  m.addEventListener("click", function (e) { if (e.target.tagName === "A") { m.classList.remove("open"); b.setAttribute("aria-expanded", false); } });
  var els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) return els.forEach(function (e) { e.classList.add("in"); });
  var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }); }, { threshold: 0.12 });
  els.forEach(function (e) { io.observe(e); });
})();

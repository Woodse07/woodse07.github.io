/*
 * Live departure board, fetched from the self-hosted service.
 *
 * Fails silently and on purpose. If the server at home is down, the tunnel is
 * off, or the request is slow, the written description of the project stands on
 * its own and nothing appears. A broken widget on a portfolio is worse than no
 * widget, so there is no error state to render.
 *
 * The response is proxied third-party data, so every value goes into the DOM as
 * text. Nothing here builds markup from it.
 */

(function () {
  var mount = document.getElementById("departures");
  if (!mount) return;
  if (!window.fetch || !window.AbortController) return;

  var ENDPOINT = "https://trains.oods.dev/display?mins=90";
  var TIMEOUT_MS = 4000;
  var MAX_ROWS = 5;

  var cell = function (row, text, className) {
    var td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    row.appendChild(td);
  };

  var render = function (data) {
    var trains = (data && data.trains) || [];
    if (!trains.length) return;

    var table = document.createElement("table");
    table.className = "departures";

    var caption = document.createElement("caption");
    caption.textContent = "Next departures — " + (data.station || "Dublin Heuston");
    table.appendChild(caption);

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Destination", "Expected", "Due"].forEach(function (label) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    trains.slice(0, MAX_ROWS).forEach(function (train) {
      var row = document.createElement("tr");
      cell(row, train.display_name || "—");
      cell(row, train.expected || train.scheduled || "—");

      var due = typeof train.due_mins === "number" ? train.due_mins + " min" : "—";
      var late = Number(train.late_mins) > 0 ? train.late_mins + " min late" : "";
      cell(row, late ? due + " · " + late : due, late ? "late" : "");

      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    mount.appendChild(table);
    mount.hidden = false;
  };

  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, TIMEOUT_MS);

  fetch(ENDPOINT, { signal: controller.signal })
    .then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then(function (data) {
      clearTimeout(timer);
      render(data);
    })
    .catch(function () {
      clearTimeout(timer);
      // Deliberately silent: the card already describes the project.
    });
})();

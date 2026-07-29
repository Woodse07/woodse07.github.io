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

    // The caption carries the proof that this is live rather than illustrative:
    // a pulsing dot, the host it came from, and the time it arrived. The
    // timestamp is taken from the browser rather than the payload's own
    // `as_of`, which the service currently reports in UTC while its train times
    // are local — so it would read an hour behind.
    var caption = document.createElement("caption");

    var dot = document.createElement("span");
    dot.className = "live-dot";
    dot.setAttribute("aria-hidden", "true");
    caption.appendChild(dot);

    // hour12 forced off so this matches the 24-hour times in the table below;
    // a US-defaulted locale would otherwise render "07:37 PM" beside "19:42".
    var fetchedAt = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    caption.appendChild(
      document.createTextNode(
        "Live · " +
          (data.station || "Dublin Heuston") +
          " · fetched " +
          fetchedAt
      )
    );
    table.appendChild(caption);

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    // Not "Destination": the feed is trains passing the house in both
    // directions, and display_name is the destination only for departures. For
    // arrivals it is the origin, so the column is labelled neutrally and each
    // row says which it is.
    ["Service", "Expected", "Due"].forEach(function (label) {
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

      // west = departing Heuston, so display_name is where it is going.
      // east = arriving, so display_name is where it has come from.
      var name = train.display_name || "—";
      var prefix = train.direction === "east" ? "from " : train.direction === "west" ? "to " : "";
      cell(row, prefix + name);

      cell(row, train.expected || train.scheduled || "—");

      var due = typeof train.due_mins === "number" ? train.due_mins + " min" : "—";
      var late = Number(train.late_mins) > 0 ? train.late_mins + " min late" : "";
      cell(row, late ? due + " · " + late : due, late ? "late" : "");

      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    // A refresh replaces the table, so clear the previous one first.
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(table);
    mount.hidden = false;

    // Only now is it true that there is a table to describe.
    var note = document.getElementById("departures-note");
    if (note) note.hidden = false;

    // The button is created on the first successful render, so it never
    // appears offering to refresh a table that is not there.
    if (refresh && refresh.hidden) refresh.hidden = false;
  };

  var refresh = document.getElementById("departures-refresh");
  var inFlight = false;

  var load = function () {
    if (inFlight) return;
    inFlight = true;
    if (refresh) refresh.disabled = true;

    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, TIMEOUT_MS);

    var done = function () {
      clearTimeout(timer);
      inFlight = false;
      if (refresh) refresh.disabled = false;
    };

    // no-store, or a refresh can be answered from cache and change nothing.
    fetch(ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(function (data) {
        done();
        render(data);
      })
      .catch(function () {
        done();
        // Deliberately silent on first load: the card already describes the
        // project. If a table is already showing, it simply stays as it was.
      });
  };

  if (refresh) refresh.addEventListener("click", load);
  load();
})();

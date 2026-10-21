/**
 * Treadmill Log -> Supabase sync
 * Add this as a new file in the Treadmill Log's Apps Script project.
 *
 * One-time setup (Project Settings -> Script Properties):
 *   SUPABASE_URL      = https://jhunufgtetzqkswtstdv.supabase.co
 *   SUPABASE_SECRET   = your project's secret key (sb_secret_...) from
 *                       Supabase dashboard -> Project Settings -> API Keys
 *   SUPABASE_USER_ID  = d3704d78-9714-4203-870c-a17385fc145f
 *
 * Then, in your existing doPost(), right after the sheet.appendRow(...) line, add:
 *   syncSessionToSupabase(person, startTime, endTime, durationS, distanceMi, avgSpeedMph);
 *
 * Re-running syncAllSheetRows() is always safe: each session gets a stable ID
 * from person + start time, so repeats update instead of duplicating.
 */

const PERSON_TABS = ['Warren', 'Leah', 'Evan', 'Susan'];

function syncSessionToSupabase(person, startTime, endTime, durationS, distanceMi, avgSpeedMph) {
  try {
    const row = buildRow_(person, startTime, endTime, durationS, distanceMi, avgSpeedMph, 'esp32');
    upsertRows_([row]);
  } catch (err) {
    // Never let a Supabase hiccup block the sheet log; syncAllSheetRows() catches it up later.
    console.error('Supabase sync failed: ' + err);
  }
}

/** Push every row in every person tab. Run manually, or on a daily time trigger as a safety net. */
function syncAllSheetRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Keyed by workout ID: if the ESP32 logged the same workout twice (same person +
  // start time), the later sheet row wins. Supabase rejects a batch that contains
  // the same workout twice, so this also keeps the nightly sync from failing.
  const byId = {};
  PERSON_TABS.forEach(function (person) {
    const sheet = ss.getSheetByName(person);
    if (!sheet || sheet.getLastRow() < 2) return;
    // Columns: Logged At | Start Time | End Time | Duration (s) | Distance (mi) | Avg Speed (mph)
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues();
    values.forEach(function (v) {
      if (!v[1]) return;
      const row = buildRow_(person, v[1], v[2], v[3], v[4], v[5], null);
      delete row.source; // keep whatever source the row already has in Supabase
      byId[row.client_id] = row;
    });
  });
  const rows = Object.keys(byId).map(function (k) { return byId[k]; });
  for (let i = 0; i < rows.length; i += 200) upsertRows_(rows.slice(i, i + 200));
  console.log('Synced ' + rows.length + ' rows to Supabase');
}

// ---------- helpers ----------

function buildRow_(person, startTime, endTime, durationS, distanceMi, avgSpeedMph, source) {
  const tz = Session.getScriptTimeZone();
  const start = toDate_(startTime);
  const end = toDate_(endTime);
  const startKey = Utilities.formatDate(start, tz, 'yyyy-MM-dd HH:mm:ss');
  return {
    user_id: prop_('SUPABASE_USER_ID'),
    client_id: stableUuid_(person + '|' + startKey),
    person: person,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    duration_s: Math.round(Number(durationS) || 0),
    distance_mi: Number(distanceMi) || 0,
    avg_speed_mph: avgSpeedMph === '' || avgSpeedMph == null ? null : Number(avgSpeedMph),
    source: source
  };
}

function upsertRows_(rows) {
  if (!rows.length) return;
  const url = prop_('SUPABASE_URL') +
    '/rest/v1/treadmill_sessions?on_conflict=user_id,client_id';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: prop_('SUPABASE_SECRET'),
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('HTTP ' + code + ': ' + res.getContentText());
}

function toDate_(v) {
  if (v instanceof Date) return v;
  const s = String(v).trim().replace(' ', 'T'); // "2026-08-23 12:01:42" -> local time
  const d = new Date(s);
  if (isNaN(d)) throw new Error('Unparseable time: ' + v);
  return d;
}

/** Same result as Postgres md5(key)::uuid, so IDs line up with the backfilled rows. */
function stableUuid_(key) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key, Utilities.Charset.UTF_8);
  const hex = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
         hex.slice(16, 20) + '-' + hex.slice(20);
}

function prop_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Missing Script Property: ' + name);
  return v;
}

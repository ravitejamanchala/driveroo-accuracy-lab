# Driveroo Accuracy Lab

An isolated road-accuracy experiment copied from `ravitejamanchala/cambridge-learner-driv` at `bb014e833a52313d6a774550090778856ba95cf5`.

The original repository and deployment are untouched. This repository is private. The `baseline` branch contains the unmodified source snapshot; `main` contains the experiment. It is a source snapshot, not a complete copy of the original Git history.

## Try it

Requires Python 3; Node.js 22+ is needed only for tests and map tools. No package installation is needed to serve the source.

```sh
git clone https://github.com/ravitejamanchala/driveroo-accuracy-lab.git
cd driveroo-accuracy-lab
python3 -m http.server 8000
```

Open **http://localhost:8000/editor.html** for the overhead editor, or **http://localhost:8000/** for the simulator. The simulator's existing Three.js assets load from CDNs, so the driving view requires internet access.

1. Search for a road and select a section. The initial selection is Milton Road.
2. Change its total carriageway width or directional lane counts and apply.
3. Drag interior control points to reshape it; double-click a segment to insert a control point. Junction endpoints stay fixed to preserve connectivity.
4. Place or move manual lamps on clear pavement. Draw an island/reservation outline and finish it. Undo reverses edits from this session.
5. Use **Show original geometry** to compare source centreline positions and dimensions. This uses the new geometry renderer for both states; use the `baseline` branch to compare the complete old renderer.
6. Choose **Try the drive**. If a drive tab is already open, reload it to pick up edits. Select a lesson or route using the edited road.
7. Export `corrections.json` and replace `data/corrections.json` to keep edits with the project. Import replaces the current draft; Undo can restore it in the same session.

Drafts are saved in the current browser origin under `driveroo-accuracy-lab:corrections:v1`. They override the committed correction file. Learner profiles and preferences have separate experiment keys. A different hostname or port has separate storage. To discard a stale draft, remove that one key in browser storage; export first if needed.

## Implemented

- Shared bounded-miter geometry for road strips, painted dashes and offset driving paths. Dashes split at bends rather than cutting straight across them. Extremely sharp corners still use a capped approximation.
- Directional lane counts and an offset opposing-traffic boundary for asymmetric roads; traffic lane centres and relevant examiner checks use those bounds.
- OSM importer support for explicit metre widths, directional lane counts, supported lane arrows, stable OSM IDs, and off-road `highway=street_lamp` points. Imported shapes use a lower simplification tolerance. Existing v1 map files remain supported.
- Explicit lamp positions take precedence over fallback lamps. Generated lamps are checked against nearby carriageways and junction setbacks; the editor can disable inferred lamps.
- Manual polygon islands/reservations, with a player-position fault check and replacement of an inferred circular island whose centre falls inside the manual polygon.
- Corrections identified by road identity, endpoints and a source-geometry hash rather than area-local array indices, so the same edit applies to the full map and its area extracts.
- Source stop lines and crossings are reprojected after an interior geometry edit instead of keeping obsolete distances.
- JSON import/export, local drafts, undo, input validation and source/estimate labels.

## Accuracy limits and next work

**This is an engineering prototype, not a surveyed recreation of Cambridge.** The checked-in map is the original compact data; it does not gain missing width, lamp or lane tags merely by updating the importer. Re-import a suitable GeoJSON export to use newly supported metadata. The correction file deliberately starts empty; no invented road dimensions are presented as measured values.

- Unknown odd lane counts use a deterministic inferred split. Confirm the actual direction of the extra lane before teaching or assessing that section. Shared bidirectional turn lanes and per-lane width profiles are not supported.
- Width is constant within each edited section. Junction surface unions, curved kerb returns, grade separation, lane tapers and constrained splines remain future work.
- Unsupported or absent lane markings can still use legacy inference. The editor currently changes geometry/lane counts, not individual painted arrow types or the complete marking specification.
- Lane-arrow rendering uses supported imported tags; the legacy route examiner still uses heuristic turn-lane requirements. Complex signed junctions need lane-connection and examiner-rule work.
- Manual islands are rendered and fault-checked, but AI traffic does not yet plan around new obstacles. Keep polygons clear of existing lane-centre paths until the surrounding road/lane geometry is corrected. There is no new rigid-body island collision.
- Inferred lamps are plausible placements, not actual surveyed locations; cross-chunk spacing can still vary. Imported lamp positions are retained even if source data places them unexpectedly.
- Source IDs/endpoints/geometry hashes are stable across area splitting. A fresh import that changes geometry can invalidate correction keys; review/reconcile those edits.
- No aerial image overlay or external imagery is bundled. Validate against suitable reference material before calling a location accurate.

Start with one junction and its approaches. Verify road widths, lane directions, stop positions and island outlines against a trusted reference, then drive each permitted movement before expanding coverage.

## Validation

```sh
npm test
node tools/split_areas.mjs
```

17 automated tests pass: 13 JavaScript geometry/network/correction tests and 4 Python importer tests. The existing 36 driving plans build across all 14 generated areas without route-difference warnings. These checks verify implementation and routing compatibility, not geographic truth.

**Browser visual QA and a driving playthrough are still pending.** The available browsers could not reach the isolated development server. No visual accuracy or frame-rate claim is made.

## Import and attribution

```sh
python3 -I tools/build_net.py export.geojson data/cambridge.json
node tools/split_areas.mjs
```

Include street-lamp point features in the source export; road-only exports cannot recover them. Preserve OpenStreetMap attribution and the applicable data licence. Existing map data: © OpenStreetMap contributors, ODbL.

Useful references:
- https://www.gov.uk/government/publications/traffic-signs-manual
- https://wiki.openstreetmap.org/wiki/Lanes
- https://wiki.openstreetmap.org/wiki/Tag:highway%3Dstreet_lamp

## Map studio and live geometry preview

Open `editor.html`. Select/drag road controls, lamps, painted markings and islands.
The live panel provides a 1.25 m driver-eye camera or a raised follow camera; click
**Place car** and a road, scrub the distance slider, or travel along the selected
section. Geometry updates during edits. This lightweight preview omits buildings,
traffic and some original street decoration; use **Try the drive** for the full engine.

- Road inspector: width, directional lane counts, centre/lane line styles, and an
  endpoint-preserving smoothed curve. Control handles remain editable.
- Marking tool: dashed, solid, double lines, zebra stripes and stop bars. Select,
  drag, edit dimensions or delete custom paint. Existing centre/lane paint is
  controlled through road styles; source crossings/signals are not individually editable yet.
- Divider: draw a path, set width and height, then Enter. Select its resulting
  polygon to move or reshape vertices; height remains editable.
- Lamp: place, move or delete. Deleting mapped/generated lamps stores a suppression
  record, preserving source data. Undo/redo applies to geometry and furniture.
- Space/middle/right drag pans, scroll zooms at cursor; V/H/L/M/D/I/C select tools,
  Delete removes selection, F fits, Escape cancels, Ctrl/Cmd-Z undoes, Shift-Z redoes.
- Layer controls filter the overhead map only. JSON import/export and automatic
  local draft persistence remain available. Drafts are per browser/origin.
- Mapillary reference opens the selected section’s location. It does not claim
  imagery coverage or import detections. Automated suggestions require API access,
  source/date attribution, coordinate checks and review before publication.

## Exported maps, GitHub Pages and CDN loading

**Export map package** downloads `cambridge-map.json` containing the original
network plus corrections, schema/version and OSM attribution. The source geometry
is retained so stable correction IDs survive a round-trip. Reimport it in the editor.

CLI: `node tools/export_map.mjs data/corrections.json maps/v1/cambridge-map.json`.
Use a new version directory (v2, v3…) for releases; do not overwrite published versions
if clients depend on their exact content. `maps/v1/` is the initial uncorrected export.

The static repo can be served directly by GitHub Pages (main branch, repository root).
No build or backend is required. Keep `.nojekyll`. Private repositories require a
compatible GitHub plan; the Pages site normally exposes the published static files.
No automatic repository visibility change is performed by this project.

After hosting a package, open:

`index.html?map=https%3A%2F%2Fyour-host.example%2Fmaps%2Fv1%2Fcambridge-map.json`

The editor’s **Load URL in engine** builds that link for you. Remote packages use
HTTPS, omit credentials, have a 20-second timeout and basic schema/size validation.
External hosts must provide CORS allowing the engine origin. A remote package takes
precedence over browser drafts and bundled corrections; a failed URL reports an
error, rather than silently replacing it with a different map. The current lesson
catalog remains Cambridge-specific. The full package is loaded once and reused for
areas; tile/chunk streaming is future work for national coverage.

The private ChatGPT Site is a review deployment, not a public cross-origin CDN.
Publish the JSON on Pages or another public static host for independent engines.
Browser edits are local until exported and committed/uploaded; there are no GitHub
write tokens or Mapillary secrets in client code.

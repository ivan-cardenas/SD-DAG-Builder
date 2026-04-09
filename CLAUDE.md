# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

System Dynamics Builder is a browser-based visual modeling tool for building stock-flow diagrams, part of the CrossTwin Platform. It lets users create system dynamics models, validate units, run simulations (Euler/RK4), and export to Django/GeoDjango models or Vensim MDL format. Author: Ivan Cardenas-Leon, University of Twente, Faculty ITC.

## Development

This is a pure frontend project with no build step, no package manager, and no test framework. To develop:

- Open `app.html` (the main modeling tool) directly in a browser, or serve with any static file server
- `Index.html` is the landing/marketing page (separate from the app)
- The only external dependency is Chart.js loaded via CDN in `app.html`

## Architecture

The app is a single-page SVG canvas editor split across three files:

- **`app.html`** - Main app shell: toolbar, SVG canvas with layered groups (grid, apps, objects, edges, nodes, preview), side panel (unit validation + model tree), simulation run panel, and modal dialogs
- **`script.js`** - All application logic (~2100 lines, single file, no modules):
  - **Data model**: Four arrays — `apps`, `objects`, `nodes`, `edges` — forming a hierarchy: Apps contain Objects, Objects contain Nodes (stocks/constants), Edges connect Nodes
  - **Element types**: `app` (Django App container), `object` (Django Model container), `stock` (accumulator), `const` (fixed parameter), `flow` (rate between stocks), `aux` (intermediate calc), `link` (causal dependency)
  - **Rendering**: Direct SVG DOM manipulation via `renderAll()` which clears and redraws all layers. No virtual DOM or framework
  - **Simulation engine**: `runSimulation()` supports Euler and RK4 integration, uses `evalExpr()` for equation parsing with `new Function()` constructor
  - **Export**: Django models.py + admin.py generation (`openExportModal()`), JSON save/load, Vensim MDL export, Django models.py import
  - **Persistence**: localStorage via `saveToStorage()`/`loadFromStorage()`
- **`styles.css`** - All styling with CSS custom properties, supports light/dark mode via `prefers-color-scheme`

## Key Conventions

- IDs are generated with `genId()` as `'e' + incrementing counter`
- Canvas coordinates use SVG viewBox with zoom/pan (`viewBox` object, `currentZoom`)
- Node sizes are dynamically computed by `nodeRadius()` based on label text length
- Container resizing (apps/objects) auto-fits to children via `resizeAppToFit()`/`resizeObjectToFit()`
- Keyboard shortcuts: A=App, O=Object, S=Stock, C=Const, X=Aux, F=Flow, L=Link, V=Select, 0=Fit, Delete=remove selected

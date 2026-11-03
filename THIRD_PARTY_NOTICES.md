# Third-party notices

## Form controls and description editor

Tom Select 2.6.2 (Apache-2.0, https://tom-select.js.org/) supplies searchable,
keyboard-operable select controls. CodeMirror 6 packages (MIT,
https://codemirror.net/) supply description and JSON editing, history and syntax
highlighting. Exact package versions are pinned in package-lock.json.
The build copies their licenses to public/vendor/components and bundles all
runtime assets locally. No CDN or external editing service is used.

## AntV G6

Callgraph Visualizer bundles AntV G6 5.1.1 (MIT, Copyright (c) 2018 Alipay.inc).
Source: <https://github.com/antvis/G6>. The build copies its license to
`public/vendor/workbench/G6-LICENSE.txt`; bundled legal comments remain in
`public/vendor/workbench/workbench.js.LEGAL.txt`.

## Monaco Editor

This project bundles selected parts of Monaco Editor 0.51.0 for the local,
read-only source preview surface.

- Project: <https://github.com/microsoft/monaco-editor>
- License: MIT
- Copyright: Microsoft Corporation

The full license text is distributed with the generated assets at
`public/vendor/monaco/LICENSE.txt` and is also present in the installed package
at `node_modules/monaco-editor/LICENSE`.

The integration was informed by the MIT-licensed AntV dumi theme CodeEditor:

- Project: <https://github.com/antvis/dumi-theme-antv>
- License: MIT

No AntV remote loader, code execution, AI assistant, StackBlitz or Riddle
integration is included.

## Floating UI

Toolbar popovers use @floating-ui/dom 1.8.0 (MIT), bundled locally.
Source: <https://github.com/floating-ui/floating-ui>. Licenses for dom, core and utils
are copied to `public/vendor/components/`.

## Bootstrap

Status indicators compile only Bootstrap 5.3.8 Badge, Spinner and color helpers (MIT),
scoped to `.ui-status`. No Reboot or global stylesheet is loaded.
Source: <https://github.com/twbs/bootstrap>. License: `public/vendor/components/bootstrap-LICENSE.txt`.

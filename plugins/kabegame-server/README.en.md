# Kabegame Server

Copies images from another Kabegame web service: either the web edition (default [demo.kabegame.com](https://demo.kabegame.com)) or a desktop app with the web server enabled under Settings → Advanced (for example `http://127.0.0.1:7490`).

## Options

- **Mode**
  - **Whole gallery**: pages through every image on the server, in one of these orders:
    - **Random** (default): a fresh shuffle on every run; pages within one run never repeat each other;
    - **Time**: newest first;
    - **ID ascending**: smallest image id first.
  - **Filter**: paste a PathQL query and copy only the matching images. On the source server (web edition or desktop app), open the Advanced query dialog in the gallery, an album or a task, set the conditions, then copy the Path at the bottom, for example `images://gallery/hide/plugin/pixiv/filter_comb/sort/by-time/desc/1`. Its sort order is kept; the trailing page number is replaced by the page settings below.
- **Server URL**: root URL of the web service; the plugin reads the gallery through its `/rpc` endpoint.
- **Include hidden images** (whole gallery only): off by default; images hidden on the server are skipped and do not take up page slots. In filter mode the path decides (paths from the dialog usually start with `hide/`).
- **Page size**: 20 by default, at most 100.
- **Start page / End page**: page range, at most 10 pages per run (longer ranges are refused); pages past the last one are skipped.

## What gets copied

- The image file: from the CDN for the web edition, or through `/file` on the same port for a desktop web server.
- Metadata, copied as is; metadata shared by several images on the server stays shared locally.
- Labels, attached under the same label paths as on the server (for example `konachan/character/…`).
- Post URL from the server; left empty when the server has none, never replaced with the server's own address.
- Detail panel: rendered with the source plugin's own detail template, with the same script permissions Kabegame itself grants. The template and the source plugin's private data are cached while copying.

## Notes

The desktop web server has no authentication, so only connect to devices you trust. Image copyrights belong to their authors.

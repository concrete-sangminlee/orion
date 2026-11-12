import { useEffect, useRef } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { languages, IDisposable, editor } from 'monaco-editor'

interface EmmetProviderProps {
  monaco: Monaco | null
}

// ── HTML Tag Abbreviations ──────────────────────────────────────────────────

const SELF_CLOSING_TAGS = new Set([
  'img', 'input', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed',
  'source', 'track', 'wbr', 'param', 'command', 'keygen',
])

const HTML_TAGS = [
  // Document structure
  'html', 'head', 'body',
  // Sections
  'div', 'span', 'p', 'a', 'header', 'footer', 'nav', 'section', 'main',
  'article', 'aside', 'address', 'hgroup',
  // Headings
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'menu',
  // Text-level
  'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark',
  'abbr', 'cite', 'q', 'dfn', 'var', 'samp', 'kbd', 'data', 'time',
  'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr', 'ins', 'del',
  // Block text
  'pre', 'code', 'blockquote', 'figure', 'figcaption', 'hr', 'br',
  // Forms
  'form', 'input', 'button', 'label', 'select', 'option', 'optgroup',
  'textarea', 'fieldset', 'legend', 'datalist', 'output', 'progress',
  'meter', 'keygen',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'colgroup', 'col',
  // Media
  'img', 'video', 'audio', 'source', 'track', 'canvas', 'svg',
  'picture', 'map', 'area', 'object', 'param', 'embed',
  // Interactive
  'details', 'summary', 'dialog',
  // Embedded
  'iframe', 'portal',
  // Scripting
  'script', 'noscript', 'template', 'slot',
  // Meta/link
  'meta', 'link', 'style', 'title', 'base',
]

// ── CSS Abbreviations ───────────────────────────────────────────────────────

const CSS_ABBREVIATIONS: Record<string, { label: string; snippet: string; detail: string }> = {
  // ── Display ──
  'd':      { label: 'd',      snippet: 'display: ${1:block};',               detail: 'display: block' },
  'd:b':    { label: 'd:b',    snippet: 'display: block;',                    detail: 'display: block' },
  'd:f':    { label: 'd:f',    snippet: 'display: flex;',                     detail: 'display: flex' },
  'd:g':    { label: 'd:g',    snippet: 'display: grid;',                     detail: 'display: grid' },
  'd:n':    { label: 'd:n',    snippet: 'display: none;',                     detail: 'display: none' },
  'd:i':    { label: 'd:i',    snippet: 'display: inline;',                   detail: 'display: inline' },
  'd:ib':   { label: 'd:ib',   snippet: 'display: inline-block;',             detail: 'display: inline-block' },
  'd:if':   { label: 'd:if',   snippet: 'display: inline-flex;',              detail: 'display: inline-flex' },
  'd:ig':   { label: 'd:ig',   snippet: 'display: inline-grid;',              detail: 'display: inline-grid' },
  'd:t':    { label: 'd:t',    snippet: 'display: table;',                    detail: 'display: table' },
  'd:tc':   { label: 'd:tc',   snippet: 'display: table-cell;',               detail: 'display: table-cell' },
  'd:li':   { label: 'd:li',   snippet: 'display: list-item;',                detail: 'display: list-item' },
  'dn':     { label: 'dn',     snippet: 'display: none;',                     detail: 'display: none' },
  'df':     { label: 'df',     snippet: 'display: flex;',                     detail: 'display: flex' },
  'dif':    { label: 'dif',    snippet: 'display: inline-flex;',              detail: 'display: inline-flex' },
  'db':     { label: 'db',     snippet: 'display: block;',                    detail: 'display: block' },
  'dib':    { label: 'dib',    snippet: 'display: inline-block;',             detail: 'display: inline-block' },
  'di':     { label: 'di',     snippet: 'display: inline;',                   detail: 'display: inline' },
  'dg':     { label: 'dg',     snippet: 'display: grid;',                     detail: 'display: grid' },
  'dt':     { label: 'dt',     snippet: 'display: table;',                    detail: 'display: table' },
  // ── Visibility ──
  'v':      { label: 'v',      snippet: 'visibility: ${1:hidden};',           detail: 'visibility' },
  'v:h':    { label: 'v:h',    snippet: 'visibility: hidden;',                detail: 'visibility: hidden' },
  'v:v':    { label: 'v:v',    snippet: 'visibility: visible;',               detail: 'visibility: visible' },
  // ── Position ──
  'pos':    { label: 'pos',    snippet: 'position: ${1:relative};',           detail: 'position' },
  'pos:a':  { label: 'pos:a',  snippet: 'position: absolute;',                detail: 'position: absolute' },
  'pos:r':  { label: 'pos:r',  snippet: 'position: relative;',                detail: 'position: relative' },
  'pos:f':  { label: 'pos:f',  snippet: 'position: fixed;',                   detail: 'position: fixed' },
  'pos:s':  { label: 'pos:s',  snippet: 'position: sticky;',                  detail: 'position: sticky' },
  'poa':    { label: 'poa',    snippet: 'position: absolute;',                detail: 'position: absolute' },
  'por':    { label: 'por',    snippet: 'position: relative;',                detail: 'position: relative' },
  'pof':    { label: 'pof',    snippet: 'position: fixed;',                   detail: 'position: fixed' },
  'pos-s':  { label: 'pos-s',  snippet: 'position: sticky;',                  detail: 'position: sticky' },
  // ── Top/Right/Bottom/Left ──
  't':      { label: 't',      snippet: 'top: ${1:0};',                       detail: 'top' },
  'r':      { label: 'r',      snippet: 'right: ${1:0};',                     detail: 'right' },
  'b':      { label: 'b',      snippet: 'bottom: ${1:0};',                    detail: 'bottom' },
  'l':      { label: 'l',      snippet: 'left: ${1:0};',                      detail: 'left' },
  'inset':  { label: 'inset',  snippet: 'inset: ${1:0};',                     detail: 'inset' },
  // ── Flexbox ──
  'fxd':    { label: 'fxd',    snippet: 'flex-direction: ${1:row};',          detail: 'flex-direction' },
  'fxdc':   { label: 'fxdc',   snippet: 'flex-direction: column;',            detail: 'flex-direction: column' },
  'fd:c':   { label: 'fd:c',   snippet: 'flex-direction: column;',            detail: 'flex-direction: column' },
  'fd:r':   { label: 'fd:r',   snippet: 'flex-direction: row;',               detail: 'flex-direction: row' },
  'fd:cr':  { label: 'fd:cr',  snippet: 'flex-direction: column-reverse;',    detail: 'flex-direction: column-reverse' },
  'fd:rr':  { label: 'fd:rr',  snippet: 'flex-direction: row-reverse;',       detail: 'flex-direction: row-reverse' },
  'fxw':    { label: 'fxw',    snippet: 'flex-wrap: ${1:wrap};',              detail: 'flex-wrap' },
  'fw:w':   { label: 'fw:w',   snippet: 'flex-wrap: wrap;',                   detail: 'flex-wrap: wrap' },
  'fw:nw':  { label: 'fw:nw',  snippet: 'flex-wrap: nowrap;',                 detail: 'flex-wrap: nowrap' },
  'fw:wr':  { label: 'fw:wr',  snippet: 'flex-wrap: wrap-reverse;',           detail: 'flex-wrap: wrap-reverse' },
  'ai':     { label: 'ai',     snippet: 'align-items: ${1:center};',          detail: 'align-items' },
  'ai:c':   { label: 'ai:c',   snippet: 'align-items: center;',              detail: 'align-items: center' },
  'ai:fs':  { label: 'ai:fs',  snippet: 'align-items: flex-start;',          detail: 'align-items: flex-start' },
  'ai:fe':  { label: 'ai:fe',  snippet: 'align-items: flex-end;',            detail: 'align-items: flex-end' },
  'ai:s':   { label: 'ai:s',   snippet: 'align-items: stretch;',             detail: 'align-items: stretch' },
  'ai:b':   { label: 'ai:b',   snippet: 'align-items: baseline;',            detail: 'align-items: baseline' },
  'aic':    { label: 'aic',    snippet: 'align-items: center;',               detail: 'align-items: center' },
  'aifs':   { label: 'aifs',   snippet: 'align-items: flex-start;',           detail: 'align-items: flex-start' },
  'aife':   { label: 'aife',   snippet: 'align-items: flex-end;',             detail: 'align-items: flex-end' },
  'ac':     { label: 'ac',     snippet: 'align-content: ${1:center};',        detail: 'align-content' },
  'ac:c':   { label: 'ac:c',   snippet: 'align-content: center;',             detail: 'align-content: center' },
  'ac:fs':  { label: 'ac:fs',  snippet: 'align-content: flex-start;',         detail: 'align-content: flex-start' },
  'ac:fe':  { label: 'ac:fe',  snippet: 'align-content: flex-end;',           detail: 'align-content: flex-end' },
  'ac:sb':  { label: 'ac:sb',  snippet: 'align-content: space-between;',      detail: 'align-content: space-between' },
  'ac:sa':  { label: 'ac:sa',  snippet: 'align-content: space-around;',       detail: 'align-content: space-around' },
  'as':     { label: 'as',     snippet: 'align-self: ${1:center};',           detail: 'align-self' },
  'as:c':   { label: 'as:c',   snippet: 'align-self: center;',                detail: 'align-self: center' },
  'jc':     { label: 'jc',     snippet: 'justify-content: ${1:center};',      detail: 'justify-content' },
  'jc:c':   { label: 'jc:c',   snippet: 'justify-content: center;',           detail: 'justify-content: center' },
  'jc:sb':  { label: 'jc:sb',  snippet: 'justify-content: space-between;',    detail: 'justify-content: space-between' },
  'jc:sa':  { label: 'jc:sa',  snippet: 'justify-content: space-around;',     detail: 'justify-content: space-around' },
  'jc:se':  { label: 'jc:se',  snippet: 'justify-content: space-evenly;',     detail: 'justify-content: space-evenly' },
  'jc:fs':  { label: 'jc:fs',  snippet: 'justify-content: flex-start;',       detail: 'justify-content: flex-start' },
  'jc:fe':  { label: 'jc:fe',  snippet: 'justify-content: flex-end;',         detail: 'justify-content: flex-end' },
  'jcc':    { label: 'jcc',    snippet: 'justify-content: center;',            detail: 'justify-content: center' },
  'jcsb':   { label: 'jcsb',   snippet: 'justify-content: space-between;',    detail: 'justify-content: space-between' },
  'jcsa':   { label: 'jcsa',   snippet: 'justify-content: space-around;',     detail: 'justify-content: space-around' },
  'jcfs':   { label: 'jcfs',   snippet: 'justify-content: flex-start;',       detail: 'justify-content: flex-start' },
  'jcfe':   { label: 'jcfe',   snippet: 'justify-content: flex-end;',         detail: 'justify-content: flex-end' },
  'ji':     { label: 'ji',     snippet: 'justify-items: ${1:center};',        detail: 'justify-items' },
  'ji:c':   { label: 'ji:c',   snippet: 'justify-items: center;',             detail: 'justify-items: center' },
  'fg':     { label: 'fg',     snippet: 'flex-grow: ${1:1};',                 detail: 'flex-grow' },
  'fs':     { label: 'fs',     snippet: 'flex-shrink: ${1:0};',               detail: 'flex-shrink' },
  'fb':     { label: 'fb',     snippet: 'flex-basis: ${1:auto};',             detail: 'flex-basis' },
  'fx':     { label: 'fx',     snippet: 'flex: ${1:1};',                      detail: 'flex' },
  'ord':    { label: 'ord',    snippet: 'order: ${1:0};',                     detail: 'order' },
  'gap':    { label: 'gap',    snippet: 'gap: ${1:8px};',                     detail: 'gap' },
  'rg':     { label: 'rg',     snippet: 'row-gap: ${1:8px};',                 detail: 'row-gap' },
  'cg':     { label: 'cg',     snippet: 'column-gap: ${1:8px};',              detail: 'column-gap' },
  // ── Grid ──
  'gtc':    { label: 'gtc',    snippet: 'grid-template-columns: ${1:repeat(3, 1fr)};', detail: 'grid-template-columns' },
  'gtr':    { label: 'gtr',    snippet: 'grid-template-rows: ${1:auto};',     detail: 'grid-template-rows' },
  'gta':    { label: 'gta',    snippet: 'grid-template-areas: ${1:"header"};', detail: 'grid-template-areas' },
  'gg':     { label: 'gg',     snippet: 'grid-gap: ${1:8px};',                detail: 'grid-gap' },
  'gc':     { label: 'gc',     snippet: 'grid-column: ${1:1 / -1};',          detail: 'grid-column' },
  'gr':     { label: 'gr',     snippet: 'grid-row: ${1:1 / -1};',             detail: 'grid-row' },
  'gcs':    { label: 'gcs',    snippet: 'grid-column-start: ${1:1};',         detail: 'grid-column-start' },
  'gce':    { label: 'gce',    snippet: 'grid-column-end: ${1:-1};',          detail: 'grid-column-end' },
  'grs':    { label: 'grs',    snippet: 'grid-row-start: ${1:1};',            detail: 'grid-row-start' },
  'gre':    { label: 'gre',    snippet: 'grid-row-end: ${1:-1};',             detail: 'grid-row-end' },
  'ga':     { label: 'ga',     snippet: 'grid-area: ${1:header};',            detail: 'grid-area' },
  'gac':    { label: 'gac',    snippet: 'grid-auto-columns: ${1:1fr};',       detail: 'grid-auto-columns' },
  'gar':    { label: 'gar',    snippet: 'grid-auto-rows: ${1:auto};',         detail: 'grid-auto-rows' },
  'gaf':    { label: 'gaf',    snippet: 'grid-auto-flow: ${1:row};',          detail: 'grid-auto-flow' },
  'gaf:c':  { label: 'gaf:c',  snippet: 'grid-auto-flow: column;',            detail: 'grid-auto-flow: column' },
  'gaf:d':  { label: 'gaf:d',  snippet: 'grid-auto-flow: dense;',             detail: 'grid-auto-flow: dense' },
  'pi':     { label: 'pi',     snippet: 'place-items: ${1:center};',           detail: 'place-items' },
  'pc':     { label: 'pc',     snippet: 'place-content: ${1:center};',         detail: 'place-content' },
  'ps':     { label: 'ps',     snippet: 'place-self: ${1:center};',            detail: 'place-self' },
  // ── Sizing ──
  'w':      { label: 'w',      snippet: 'width: ${1:100%};',                  detail: 'width' },
  'h':      { label: 'h',      snippet: 'height: ${1:100%};',                 detail: 'height' },
  'mw':     { label: 'mw',     snippet: 'max-width: ${1:100%};',              detail: 'max-width' },
  'mh':     { label: 'mh',     snippet: 'max-height: ${1:100%};',             detail: 'max-height' },
  'miw':    { label: 'miw',    snippet: 'min-width: ${1:0};',                 detail: 'min-width' },
  'mih':    { label: 'mih',    snippet: 'min-height: ${1:0};',                detail: 'min-height' },
  'minw':   { label: 'minw',   snippet: 'min-width: ${1:0};',                 detail: 'min-width' },
  'minh':   { label: 'minh',   snippet: 'min-height: ${1:0};',                detail: 'min-height' },
  'w:a':    { label: 'w:a',    snippet: 'width: auto;',                        detail: 'width: auto' },
  'h:a':    { label: 'h:a',    snippet: 'height: auto;',                       detail: 'height: auto' },
  'w:100':  { label: 'w:100',  snippet: 'width: 100%;',                        detail: 'width: 100%' },
  'h:100':  { label: 'h:100',  snippet: 'height: 100%;',                       detail: 'height: 100%' },
  'w:f':    { label: 'w:f',    snippet: 'width: fit-content;',                 detail: 'width: fit-content' },
  'h:f':    { label: 'h:f',    snippet: 'height: fit-content;',                detail: 'height: fit-content' },
  // ── Margin ──
  'm':      { label: 'm',      snippet: 'margin: ${1:0};',                    detail: 'margin' },
  'mt':     { label: 'mt',     snippet: 'margin-top: ${1:0};',                detail: 'margin-top' },
  'mr':     { label: 'mr',     snippet: 'margin-right: ${1:0};',              detail: 'margin-right' },
  'mb':     { label: 'mb',     snippet: 'margin-bottom: ${1:0};',             detail: 'margin-bottom' },
  'ml':     { label: 'ml',     snippet: 'margin-left: ${1:0};',               detail: 'margin-left' },
  'mx':     { label: 'mx',     snippet: 'margin-left: ${1:0};\nmargin-right: ${1:0};', detail: 'margin-left + margin-right' },
  'my':     { label: 'my',     snippet: 'margin-top: ${1:0};\nmargin-bottom: ${1:0};', detail: 'margin-top + margin-bottom' },
  'ma':     { label: 'ma',     snippet: 'margin: auto;',                      detail: 'margin: auto' },
  'm:a':    { label: 'm:a',    snippet: 'margin: auto;',                      detail: 'margin: auto' },
  'mi':     { label: 'mi',     snippet: 'margin-inline: ${1:0};',             detail: 'margin-inline' },
  'mb:a':   { label: 'mb:a',   snippet: 'margin-block: ${1:auto};',           detail: 'margin-block' },
  // ── Padding ──
  'p':      { label: 'p',      snippet: 'padding: ${1:0};',                   detail: 'padding' },
  'pt':     { label: 'pt',     snippet: 'padding-top: ${1:0};',               detail: 'padding-top' },
  'pr':     { label: 'pr',     snippet: 'padding-right: ${1:0};',             detail: 'padding-right' },
  'pb':     { label: 'pb',     snippet: 'padding-bottom: ${1:0};',            detail: 'padding-bottom' },
  'pl':     { label: 'pl',     snippet: 'padding-left: ${1:0};',              detail: 'padding-left' },
  'px':     { label: 'px',     snippet: 'padding-left: ${1:0};\npadding-right: ${1:0};', detail: 'padding-left + padding-right' },
  'py':     { label: 'py',     snippet: 'padding-top: ${1:0};\npadding-bottom: ${1:0};', detail: 'padding-top + padding-bottom' },
  'pi:0':   { label: 'pi:0',   snippet: 'padding-inline: 0;',                 detail: 'padding-inline: 0' },
  'pb:0':   { label: 'pb:0',   snippet: 'padding-block: 0;',                  detail: 'padding-block: 0' },
  // ── Border ──
  'bd':     { label: 'bd',     snippet: 'border: ${1:1px} ${2:solid} ${3:#000};', detail: 'border' },
  'bdn':    { label: 'bdn',    snippet: 'border: none;',                      detail: 'border: none' },
  'bd:n':   { label: 'bd:n',   snippet: 'border: none;',                      detail: 'border: none' },
  'br':     { label: 'br',     snippet: 'border-radius: ${1:4px};',           detail: 'border-radius' },
  'bw':     { label: 'bw',     snippet: 'border-width: ${1:1px};',            detail: 'border-width' },
  'bs':     { label: 'bs',     snippet: 'border-style: ${1:solid};',          detail: 'border-style' },
  'bs:s':   { label: 'bs:s',   snippet: 'border-style: solid;',               detail: 'border-style: solid' },
  'bs:d':   { label: 'bs:d',   snippet: 'border-style: dashed;',              detail: 'border-style: dashed' },
  'bs:dt':  { label: 'bs:dt',  snippet: 'border-style: dotted;',              detail: 'border-style: dotted' },
  'bs:n':   { label: 'bs:n',   snippet: 'border-style: none;',                detail: 'border-style: none' },
  'bdc':    { label: 'bdc',    snippet: 'border-color: ${1:#000};',            detail: 'border-color' },
  'bt':     { label: 'bt',     snippet: 'border-top: ${1:1px} ${2:solid} ${3:#000};',    detail: 'border-top' },
  'bb':     { label: 'bb',     snippet: 'border-bottom: ${1:1px} ${2:solid} ${3:#000};', detail: 'border-bottom' },
  'bl':     { label: 'bl',     snippet: 'border-left: ${1:1px} ${2:solid} ${3:#000};',   detail: 'border-left' },
  'bri':    { label: 'bri',    snippet: 'border-right: ${1:1px} ${2:solid} ${3:#000};',  detail: 'border-right' },
  'br:50':  { label: 'br:50',  snippet: 'border-radius: 50%;',                detail: 'border-radius: 50%' },
  'brc':    { label: 'brc',    snippet: 'border-collapse: ${1:collapse};',     detail: 'border-collapse' },
  'bsp':    { label: 'bsp',    snippet: 'border-spacing: ${1:0};',             detail: 'border-spacing' },
  'ol':     { label: 'ol',     snippet: 'outline: ${1:none};',                 detail: 'outline' },
  'ol:n':   { label: 'ol:n',   snippet: 'outline: none;',                      detail: 'outline: none' },
  // ── Background ──
  'bg':     { label: 'bg',     snippet: 'background: ${1:#fff};',             detail: 'background' },
  'bgc':    { label: 'bgc',    snippet: 'background-color: ${1:#fff};',       detail: 'background-color' },
  'bgi':    { label: 'bgi',    snippet: 'background-image: url(${1:});',      detail: 'background-image' },
  'bgr':    { label: 'bgr',    snippet: 'background-repeat: ${1:no-repeat};', detail: 'background-repeat' },
  'bgp':    { label: 'bgp',    snippet: 'background-position: ${1:center};',  detail: 'background-position' },
  'bgs':    { label: 'bgs',    snippet: 'background-size: ${1:cover};',       detail: 'background-size' },
  'bgs:cv': { label: 'bgs:cv', snippet: 'background-size: cover;',            detail: 'background-size: cover' },
  'bgs:ct': { label: 'bgs:ct', snippet: 'background-size: contain;',          detail: 'background-size: contain' },
  'bg:n':   { label: 'bg:n',   snippet: 'background: none;',                  detail: 'background: none' },
  // ── Color / Typography ──
  'c':      { label: 'c',      snippet: 'color: ${1:#000};',                  detail: 'color' },
  'c:i':    { label: 'c:i',    snippet: 'color: inherit;',                    detail: 'color: inherit' },
  'fz':     { label: 'fz',     snippet: 'font-size: ${1:14px};',              detail: 'font-size' },
  'fw':     { label: 'fw',     snippet: 'font-weight: ${1:bold};',            detail: 'font-weight' },
  'fw:b':   { label: 'fw:b',   snippet: 'font-weight: bold;',                 detail: 'font-weight: bold' },
  'fw:n':   { label: 'fw:n',   snippet: 'font-weight: normal;',               detail: 'font-weight: normal' },
  'fw:100': { label: 'fw:100', snippet: 'font-weight: 100;',                  detail: 'font-weight: 100' },
  'fw:300': { label: 'fw:300', snippet: 'font-weight: 300;',                  detail: 'font-weight: 300' },
  'fw:400': { label: 'fw:400', snippet: 'font-weight: 400;',                  detail: 'font-weight: 400' },
  'fw:500': { label: 'fw:500', snippet: 'font-weight: 500;',                  detail: 'font-weight: 500' },
  'fw:600': { label: 'fw:600', snippet: 'font-weight: 600;',                  detail: 'font-weight: 600' },
  'fw:700': { label: 'fw:700', snippet: 'font-weight: 700;',                  detail: 'font-weight: 700' },
  'ff':     { label: 'ff',     snippet: 'font-family: ${1:sans-serif};',      detail: 'font-family' },
  'ff:s':   { label: 'ff:s',   snippet: 'font-family: serif;',                detail: 'font-family: serif' },
  'ff:ss':  { label: 'ff:ss',  snippet: 'font-family: sans-serif;',           detail: 'font-family: sans-serif' },
  'ff:m':   { label: 'ff:m',   snippet: 'font-family: monospace;',            detail: 'font-family: monospace' },
  'fst':    { label: 'fst',    snippet: 'font-style: ${1:italic};',           detail: 'font-style' },
  'fst:i':  { label: 'fst:i',  snippet: 'font-style: italic;',               detail: 'font-style: italic' },
  'fst:n':  { label: 'fst:n',  snippet: 'font-style: normal;',               detail: 'font-style: normal' },
  'ta':     { label: 'ta',     snippet: 'text-align: ${1:center};',           detail: 'text-align' },
  'ta:c':   { label: 'ta:c',   snippet: 'text-align: center;',                detail: 'text-align: center' },
  'ta:l':   { label: 'ta:l',   snippet: 'text-align: left;',                  detail: 'text-align: left' },
  'ta:r':   { label: 'ta:r',   snippet: 'text-align: right;',                 detail: 'text-align: right' },
  'ta:j':   { label: 'ta:j',   snippet: 'text-align: justify;',               detail: 'text-align: justify' },
  'tac':    { label: 'tac',    snippet: 'text-align: center;',                detail: 'text-align: center' },
  'tal':    { label: 'tal',    snippet: 'text-align: left;',                  detail: 'text-align: left' },
  'tar':    { label: 'tar',    snippet: 'text-align: right;',                 detail: 'text-align: right' },
  'td':     { label: 'td',     snippet: 'text-decoration: ${1:none};',        detail: 'text-decoration' },
  'td:n':   { label: 'td:n',   snippet: 'text-decoration: none;',             detail: 'text-decoration: none' },
  'td:u':   { label: 'td:u',   snippet: 'text-decoration: underline;',        detail: 'text-decoration: underline' },
  'td:lt':  { label: 'td:lt',  snippet: 'text-decoration: line-through;',     detail: 'text-decoration: line-through' },
  'tdn':    { label: 'tdn',    snippet: 'text-decoration: none;',             detail: 'text-decoration: none' },
  'tt':     { label: 'tt',     snippet: 'text-transform: ${1:uppercase};',    detail: 'text-transform' },
  'tt:u':   { label: 'tt:u',   snippet: 'text-transform: uppercase;',         detail: 'text-transform: uppercase' },
  'tt:l':   { label: 'tt:l',   snippet: 'text-transform: lowercase;',         detail: 'text-transform: lowercase' },
  'tt:c':   { label: 'tt:c',   snippet: 'text-transform: capitalize;',        detail: 'text-transform: capitalize' },
  'tt:n':   { label: 'tt:n',   snippet: 'text-transform: none;',              detail: 'text-transform: none' },
  'lh':     { label: 'lh',     snippet: 'line-height: ${1:1.5};',             detail: 'line-height' },
  'ls':     { label: 'ls',     snippet: 'letter-spacing: ${1:0.5px};',        detail: 'letter-spacing' },
  'ws':     { label: 'ws',     snippet: 'white-space: ${1:nowrap};',          detail: 'white-space' },
  'ws:nw':  { label: 'ws:nw',  snippet: 'white-space: nowrap;',               detail: 'white-space: nowrap' },
  'ws:n':   { label: 'ws:n',   snippet: 'white-space: normal;',               detail: 'white-space: normal' },
  'ws:pw':  { label: 'ws:pw',  snippet: 'white-space: pre-wrap;',             detail: 'white-space: pre-wrap' },
  'wob':    { label: 'wob',    snippet: 'word-break: ${1:break-all};',        detail: 'word-break' },
  'wob:ba': { label: 'wob:ba', snippet: 'word-break: break-all;',             detail: 'word-break: break-all' },
  'tov':    { label: 'tov',    snippet: 'text-overflow: ${1:ellipsis};',      detail: 'text-overflow' },
  'tov:e':  { label: 'tov:e',  snippet: 'text-overflow: ellipsis;',           detail: 'text-overflow: ellipsis' },
  'whs':    { label: 'whs',    snippet: 'word-spacing: ${1:0};',              detail: 'word-spacing' },
  'ti':     { label: 'ti',     snippet: 'text-indent: ${1:0};',               detail: 'text-indent' },
  'tsh':    { label: 'tsh',    snippet: 'text-shadow: ${1:0} ${2:1px} ${3:2px} ${4:rgba(0,0,0,0.2)};', detail: 'text-shadow' },
  // ── Overflow ──
  'ov':     { label: 'ov',     snippet: 'overflow: ${1:hidden};',             detail: 'overflow' },
  'ov:h':   { label: 'ov:h',   snippet: 'overflow: hidden;',                  detail: 'overflow: hidden' },
  'ov:a':   { label: 'ov:a',   snippet: 'overflow: auto;',                    detail: 'overflow: auto' },
  'ov:s':   { label: 'ov:s',   snippet: 'overflow: scroll;',                  detail: 'overflow: scroll' },
  'ov:v':   { label: 'ov:v',   snippet: 'overflow: visible;',                 detail: 'overflow: visible' },
  'ovh':    { label: 'ovh',    snippet: 'overflow: hidden;',                  detail: 'overflow: hidden' },
  'ova':    { label: 'ova',    snippet: 'overflow: auto;',                    detail: 'overflow: auto' },
  'ovs':    { label: 'ovs',    snippet: 'overflow: scroll;',                  detail: 'overflow: scroll' },
  'ovx':    { label: 'ovx',    snippet: 'overflow-x: ${1:hidden};',           detail: 'overflow-x' },
  'ovy':    { label: 'ovy',    snippet: 'overflow-y: ${1:auto};',             detail: 'overflow-y' },
  // ── Z-index / Opacity ──
  'z':      { label: 'z',      snippet: 'z-index: ${1:1};',                   detail: 'z-index' },
  'op':     { label: 'op',     snippet: 'opacity: ${1:1};',                   detail: 'opacity' },
  // ── Cursor ──
  'cur':    { label: 'cur',    snippet: 'cursor: ${1:pointer};',              detail: 'cursor' },
  'cur:p':  { label: 'cur:p',  snippet: 'cursor: pointer;',                   detail: 'cursor: pointer' },
  'cur:d':  { label: 'cur:d',  snippet: 'cursor: default;',                   detail: 'cursor: default' },
  'cur:m':  { label: 'cur:m',  snippet: 'cursor: move;',                      detail: 'cursor: move' },
  'cur:na': { label: 'cur:na', snippet: 'cursor: not-allowed;',               detail: 'cursor: not-allowed' },
  'curp':   { label: 'curp',   snippet: 'cursor: pointer;',                   detail: 'cursor: pointer' },
  'pe':     { label: 'pe',     snippet: 'pointer-events: ${1:none};',         detail: 'pointer-events' },
  'pe:n':   { label: 'pe:n',   snippet: 'pointer-events: none;',              detail: 'pointer-events: none' },
  'pe:a':   { label: 'pe:a',   snippet: 'pointer-events: auto;',              detail: 'pointer-events: auto' },
  'us':     { label: 'us',     snippet: 'user-select: ${1:none};',            detail: 'user-select' },
  'us:n':   { label: 'us:n',   snippet: 'user-select: none;',                 detail: 'user-select: none' },
  // ── Transition / Transform / Animation ──
  'trs':    { label: 'trs',    snippet: 'transition: ${1:all} ${2:0.3s} ${3:ease};', detail: 'transition' },
  'trsde':  { label: 'trsde',  snippet: 'transition-delay: ${1:0.3s};',       detail: 'transition-delay' },
  'trsdu':  { label: 'trsdu',  snippet: 'transition-duration: ${1:0.3s};',    detail: 'transition-duration' },
  'trsp':   { label: 'trsp',   snippet: 'transition-property: ${1:all};',     detail: 'transition-property' },
  'trstf':  { label: 'trstf',  snippet: 'transition-timing-function: ${1:ease};', detail: 'transition-timing-function' },
  'tf':     { label: 'tf',     snippet: 'transform: ${1:none};',              detail: 'transform' },
  'tf:r':   { label: 'tf:r',   snippet: 'transform: rotate(${1:45deg});',     detail: 'transform: rotate()' },
  'tf:s':   { label: 'tf:s',   snippet: 'transform: scale(${1:1.5});',        detail: 'transform: scale()' },
  'tf:t':   { label: 'tf:t',   snippet: 'transform: translate(${1:0}, ${2:0});', detail: 'transform: translate()' },
  'tf:t3':  { label: 'tf:t3',  snippet: 'transform: translate3d(${1:0}, ${2:0}, ${3:0});', detail: 'transform: translate3d()' },
  'anim':   { label: 'anim',   snippet: 'animation: ${1:name} ${2:1s} ${3:ease} ${4:infinite};', detail: 'animation' },
  'animn':  { label: 'animn',  snippet: 'animation-name: ${1:name};',          detail: 'animation-name' },
  'animdu': { label: 'animdu', snippet: 'animation-duration: ${1:1s};',        detail: 'animation-duration' },
  'animde': { label: 'animde', snippet: 'animation-delay: ${1:0s};',           detail: 'animation-delay' },
  'animic': { label: 'animic', snippet: 'animation-iteration-count: ${1:infinite};', detail: 'animation-iteration-count' },
  'animfm': { label: 'animfm', snippet: 'animation-fill-mode: ${1:forwards};', detail: 'animation-fill-mode' },
  // ── Box Shadow ──
  'bxsh':   { label: 'bxsh',   snippet: 'box-shadow: ${1:0} ${2:2px} ${3:4px} ${4:rgba(0,0,0,0.1)};', detail: 'box-shadow' },
  'bxsh:n': { label: 'bxsh:n', snippet: 'box-shadow: none;',                  detail: 'box-shadow: none' },
  'bxshn':  { label: 'bxshn',  snippet: 'box-shadow: none;',                  detail: 'box-shadow: none' },
  // ── Box Sizing ──
  'bxz':    { label: 'bxz',    snippet: 'box-sizing: border-box;',            detail: 'box-sizing: border-box' },
  'bxz:bb': { label: 'bxz:bb', snippet: 'box-sizing: border-box;',            detail: 'box-sizing: border-box' },
  'bxz:cb': { label: 'bxz:cb', snippet: 'box-sizing: content-box;',           detail: 'box-sizing: content-box' },
  // ── Float / Clear ──
  'fl':     { label: 'fl',     snippet: 'float: ${1:left};',                  detail: 'float' },
  'fl:l':   { label: 'fl:l',   snippet: 'float: left;',                       detail: 'float: left' },
  'fl:r':   { label: 'fl:r',   snippet: 'float: right;',                      detail: 'float: right' },
  'fl:n':   { label: 'fl:n',   snippet: 'float: none;',                       detail: 'float: none' },
  'cl':     { label: 'cl',     snippet: 'clear: ${1:both};',                  detail: 'clear' },
  'cl:b':   { label: 'cl:b',   snippet: 'clear: both;',                       detail: 'clear: both' },
  // ── List Style ──
  'lis':    { label: 'lis',    snippet: 'list-style: ${1:none};',             detail: 'list-style' },
  'lis:n':  { label: 'lis:n',  snippet: 'list-style: none;',                  detail: 'list-style: none' },
  // ── Content ──
  'cnt':    { label: 'cnt',    snippet: "content: '${1:}';",                  detail: 'content' },
  'cnt:e':  { label: 'cnt:e',  snippet: "content: '';",                        detail: "content: ''" },
  // ── Resize / Appearance ──
  'rsz':    { label: 'rsz',    snippet: 'resize: ${1:none};',                 detail: 'resize' },
  'rsz:n':  { label: 'rsz:n',  snippet: 'resize: none;',                      detail: 'resize: none' },
  'ap':     { label: 'ap',     snippet: 'appearance: ${1:none};',             detail: 'appearance' },
  'ap:n':   { label: 'ap:n',   snippet: 'appearance: none;',                  detail: 'appearance: none' },
  // ── Object Fit ──
  'objf':   { label: 'objf',   snippet: 'object-fit: ${1:cover};',            detail: 'object-fit' },
  'objf:cv':{ label: 'objf:cv',snippet: 'object-fit: cover;',                 detail: 'object-fit: cover' },
  'objf:ct':{ label: 'objf:ct',snippet: 'object-fit: contain;',               detail: 'object-fit: contain' },
  'objp':   { label: 'objp',   snippet: 'object-position: ${1:center};',      detail: 'object-position' },
  // ── Aspect Ratio ──
  'ar':     { label: 'ar',     snippet: 'aspect-ratio: ${1:16 / 9};',         detail: 'aspect-ratio' },
  // ── Scroll Behavior ──
  'sb':     { label: 'sb',     snippet: 'scroll-behavior: ${1:smooth};',      detail: 'scroll-behavior' },
  'sb:s':   { label: 'sb:s',   snippet: 'scroll-behavior: smooth;',           detail: 'scroll-behavior: smooth' },
  // ── Container Query ──
  'ctype':  { label: 'ctype',  snippet: 'container-type: ${1:inline-size};',  detail: 'container-type' },
  'cname':  { label: 'cname',  snippet: 'container-name: ${1:sidebar};',      detail: 'container-name' },
  // ── Filter / Backdrop ──
  'fil':    { label: 'fil',    snippet: 'filter: ${1:blur(4px)};',            detail: 'filter' },
  'bdf':    { label: 'bdf',    snippet: 'backdrop-filter: ${1:blur(10px)};',  detail: 'backdrop-filter' },
  // ── Clip / Mask ──
  'cp':     { label: 'cp',     snippet: 'clip-path: ${1:circle(50%)};',       detail: 'clip-path' },
  // ── Columns ──
  'colc':   { label: 'colc',   snippet: 'column-count: ${1:2};',              detail: 'column-count' },
  'colg':   { label: 'colg',   snippet: 'column-gap: ${1:16px};',             detail: 'column-gap' },
  // ── Will Change ──
  'wc':     { label: 'wc',     snippet: 'will-change: ${1:transform};',       detail: 'will-change' },
  // ── Isolation ──
  'iso':    { label: 'iso',    snippet: 'isolation: ${1:isolate};',            detail: 'isolation' },
  // ── Mix Blend Mode ──
  'mbm':    { label: 'mbm',    snippet: 'mix-blend-mode: ${1:multiply};',     detail: 'mix-blend-mode' },
  // ── Accent Color ──
  'acc':    { label: 'acc',    snippet: 'accent-color: ${1:auto};',            detail: 'accent-color' },
  // ── Color Scheme ──
  'csc':    { label: 'csc',    snippet: 'color-scheme: ${1:light dark};',      detail: 'color-scheme' },
}

// ── HTML Snippet Shortcuts ──────────────────────────────────────────────────

const HTML_SNIPPETS: Record<string, { label: string; snippet: string; detail: string }> = {
  '!': {
    label: '!',
    snippet: [
      '<!DOCTYPE html>',
      '<html lang="${1:en}">',
      '<head>',
      '\t<meta charset="UTF-8">',
      '\t<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '\t<title>${2:Document}</title>',
      '</head>',
      '<body>',
      '\t$0',
      '</body>',
      '</html>',
    ].join('\n'),
    detail: 'HTML5 boilerplate',
  },
  'doc': {
    label: 'doc',
    snippet: [
      '<!DOCTYPE html>',
      '<html lang="${1:en}">',
      '<head>',
      '\t<meta charset="UTF-8">',
      '\t<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '\t<title>${2:Document}</title>',
      '</head>',
      '<body>',
      '\t$0',
      '</body>',
      '</html>',
    ].join('\n'),
    detail: 'HTML5 boilerplate',
  },
  'doc4': {
    label: 'doc4',
    snippet: [
      '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">',
      '<html lang="${1:en}">',
      '<head>',
      '\t<meta http-equiv="Content-Type" content="text/html;charset=${2:UTF-8}">',
      '\t<title>${3:Document}</title>',
      '</head>',
      '<body>',
      '\t$0',
      '</body>',
      '</html>',
    ].join('\n'),
    detail: 'HTML4 boilerplate',
  },
  // ── Link / Style / Script ──
  'link:css': {
    label: 'link:css',
    snippet: '<link rel="stylesheet" href="${1:style.css}">',
    detail: 'CSS link tag',
  },
  'link:favicon': {
    label: 'link:favicon',
    snippet: '<link rel="shortcut icon" href="${1:favicon.ico}" type="image/x-icon">',
    detail: 'Favicon link tag',
  },
  'link:icon': {
    label: 'link:icon',
    snippet: '<link rel="icon" type="image/${1:png}" href="${2:favicon.png}">',
    detail: 'Icon link tag',
  },
  'link:manifest': {
    label: 'link:manifest',
    snippet: '<link rel="manifest" href="${1:manifest.json}">',
    detail: 'Web manifest link',
  },
  'link:apple': {
    label: 'link:apple',
    snippet: '<link rel="apple-touch-icon" href="${1:icon.png}">',
    detail: 'Apple touch icon',
  },
  'link:preconnect': {
    label: 'link:preconnect',
    snippet: '<link rel="preconnect" href="${1:https://}">',
    detail: 'Preconnect hint',
  },
  'link:preload': {
    label: 'link:preload',
    snippet: '<link rel="preload" href="${1:}" as="${2:font}" type="${3:font/woff2}" crossorigin>',
    detail: 'Preload resource',
  },
  'link:dns': {
    label: 'link:dns',
    snippet: '<link rel="dns-prefetch" href="${1:https://}">',
    detail: 'DNS prefetch',
  },
  'link:canonical': {
    label: 'link:canonical',
    snippet: '<link rel="canonical" href="${1:https://}">',
    detail: 'Canonical URL',
  },
  'script:src': {
    label: 'script:src',
    snippet: '<script src="${1:script.js}"></script>',
    detail: 'Script with src',
  },
  'script:module': {
    label: 'script:module',
    snippet: '<script type="module" src="${1:main.js}"></script>',
    detail: 'ES module script',
  },
  'script:defer': {
    label: 'script:defer',
    snippet: '<script defer src="${1:script.js}"></script>',
    detail: 'Deferred script',
  },
  'script:async': {
    label: 'script:async',
    snippet: '<script async src="${1:script.js}"></script>',
    detail: 'Async script',
  },
  'style': {
    label: 'style',
    snippet: '<style>\n\t$0\n</style>',
    detail: 'Style block',
  },
  'noscript': {
    label: 'noscript',
    snippet: '<noscript>\n\t${1:JavaScript is required}\n</noscript>',
    detail: 'Noscript fallback',
  },
  // ── Meta Tags ──
  'meta:vp': {
    label: 'meta:vp',
    snippet: '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    detail: 'Viewport meta tag',
  },
  'meta:charset': {
    label: 'meta:charset',
    snippet: '<meta charset="${1:UTF-8}">',
    detail: 'Charset meta tag',
  },
  'meta:utf': {
    label: 'meta:utf',
    snippet: '<meta charset="UTF-8">',
    detail: 'UTF-8 charset',
  },
  'meta:desc': {
    label: 'meta:desc',
    snippet: '<meta name="description" content="${1:}">',
    detail: 'Description meta tag',
  },
  'meta:kw': {
    label: 'meta:kw',
    snippet: '<meta name="keywords" content="${1:}">',
    detail: 'Keywords meta tag',
  },
  'meta:author': {
    label: 'meta:author',
    snippet: '<meta name="author" content="${1:}">',
    detail: 'Author meta tag',
  },
  'meta:robots': {
    label: 'meta:robots',
    snippet: '<meta name="robots" content="${1:index, follow}">',
    detail: 'Robots meta tag',
  },
  'meta:theme': {
    label: 'meta:theme',
    snippet: '<meta name="theme-color" content="${1:#ffffff}">',
    detail: 'Theme color meta tag',
  },
  'meta:compat': {
    label: 'meta:compat',
    snippet: '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    detail: 'IE compatibility meta tag',
  },
  'meta:redirect': {
    label: 'meta:redirect',
    snippet: '<meta http-equiv="refresh" content="${1:0};url=${2:https://}">',
    detail: 'Redirect meta tag',
  },
  // ── Open Graph ──
  'og:title': {
    label: 'og:title',
    snippet: '<meta property="og:title" content="${1:}">',
    detail: 'OG title',
  },
  'og:desc': {
    label: 'og:desc',
    snippet: '<meta property="og:description" content="${1:}">',
    detail: 'OG description',
  },
  'og:img': {
    label: 'og:img',
    snippet: '<meta property="og:image" content="${1:}">',
    detail: 'OG image',
  },
  'og:url': {
    label: 'og:url',
    snippet: '<meta property="og:url" content="${1:}">',
    detail: 'OG URL',
  },
  'og:type': {
    label: 'og:type',
    snippet: '<meta property="og:type" content="${1:website}">',
    detail: 'OG type',
  },
  'og:site': {
    label: 'og:site',
    snippet: '<meta property="og:site_name" content="${1:}">',
    detail: 'OG site name',
  },
  'og:locale': {
    label: 'og:locale',
    snippet: '<meta property="og:locale" content="${1:en_US}">',
    detail: 'OG locale',
  },
  // ── Twitter Cards ──
  'twitter:card': {
    label: 'twitter:card',
    snippet: '<meta name="twitter:card" content="${1:summary_large_image}">',
    detail: 'Twitter card type',
  },
  'twitter:title': {
    label: 'twitter:title',
    snippet: '<meta name="twitter:title" content="${1:}">',
    detail: 'Twitter title',
  },
  'twitter:desc': {
    label: 'twitter:desc',
    snippet: '<meta name="twitter:description" content="${1:}">',
    detail: 'Twitter description',
  },
  'twitter:img': {
    label: 'twitter:img',
    snippet: '<meta name="twitter:image" content="${1:}">',
    detail: 'Twitter image',
  },
  // ── Anchor Tags ──
  'a:link': {
    label: 'a:link',
    snippet: '<a href="${1:https://}">${2:link}</a>',
    detail: 'Anchor with href',
  },
  'a:mail': {
    label: 'a:mail',
    snippet: '<a href="mailto:${1:}">${2:email}</a>',
    detail: 'Mailto link',
  },
  'a:tel': {
    label: 'a:tel',
    snippet: '<a href="tel:${1:}">${2:phone}</a>',
    detail: 'Telephone link',
  },
  'a:blank': {
    label: 'a:blank',
    snippet: '<a href="${1:https://}" target="_blank" rel="noopener noreferrer">${2:link}</a>',
    detail: 'Link opening in new tab',
  },
  // ── Images / Media ──
  'img': {
    label: 'img',
    snippet: '<img src="${1:}" alt="${2:}">',
    detail: '<img> with src and alt',
  },
  'img:lazy': {
    label: 'img:lazy',
    snippet: '<img src="${1:}" alt="${2:}" loading="lazy">',
    detail: 'Lazy-loaded image',
  },
  'pic': {
    label: 'pic',
    snippet: '<picture>\n\t<source srcset="${1:}" type="image/${2:webp}">\n\t<img src="${3:}" alt="${4:}">\n</picture>',
    detail: 'Picture element with source',
  },
  'video': {
    label: 'video',
    snippet: '<video src="${1:}" controls${2: autoplay}${3: muted}>\n\t${4:Your browser does not support the video tag.}\n</video>',
    detail: 'Video element',
  },
  'audio': {
    label: 'audio',
    snippet: '<audio src="${1:}" controls>\n\t${2:Your browser does not support the audio tag.}\n</audio>',
    detail: 'Audio element',
  },
  'source': {
    label: 'source',
    snippet: '<source srcset="${1:}" type="${2:image/webp}">',
    detail: 'Source element',
  },
  'iframe': {
    label: 'iframe',
    snippet: '<iframe src="${1:}" frameborder="0" width="${2:100%}" height="${3:400}"></iframe>',
    detail: 'Iframe element',
  },
  'canvas': {
    label: 'canvas',
    snippet: '<canvas id="${1:canvas}" width="${2:400}" height="${3:300}"></canvas>',
    detail: 'Canvas element',
  },
  'svg': {
    label: 'svg',
    snippet: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${1:24} ${2:24}" width="${3:24}" height="${4:24}">\n\t$0\n</svg>',
    detail: 'SVG element',
  },
  // ── Input Types ──
  'input:text': {
    label: 'input:text',
    snippet: '<input type="text" name="${1:}" id="${2:}">',
    detail: 'Text input',
  },
  'input:password': {
    label: 'input:password',
    snippet: '<input type="password" name="${1:}" id="${2:}">',
    detail: 'Password input',
  },
  'input:checkbox': {
    label: 'input:checkbox',
    snippet: '<input type="checkbox" name="${1:}" id="${2:}">',
    detail: 'Checkbox input',
  },
  'input:radio': {
    label: 'input:radio',
    snippet: '<input type="radio" name="${1:}" id="${2:}">',
    detail: 'Radio input',
  },
  'input:submit': {
    label: 'input:submit',
    snippet: '<input type="submit" value="${1:Submit}">',
    detail: 'Submit input',
  },
  'input:email': {
    label: 'input:email',
    snippet: '<input type="email" name="${1:}" id="${2:}" placeholder="${3:}">',
    detail: 'Email input',
  },
  'input:tel': {
    label: 'input:tel',
    snippet: '<input type="tel" name="${1:}" id="${2:}" placeholder="${3:}">',
    detail: 'Telephone input',
  },
  'input:url': {
    label: 'input:url',
    snippet: '<input type="url" name="${1:}" id="${2:}" placeholder="${3:}">',
    detail: 'URL input',
  },
  'input:number': {
    label: 'input:number',
    snippet: '<input type="number" name="${1:}" id="${2:}" min="${3:0}" max="${4:100}" step="${5:1}">',
    detail: 'Number input',
  },
  'input:range': {
    label: 'input:range',
    snippet: '<input type="range" name="${1:}" id="${2:}" min="${3:0}" max="${4:100}">',
    detail: 'Range input',
  },
  'input:date': {
    label: 'input:date',
    snippet: '<input type="date" name="${1:}" id="${2:}">',
    detail: 'Date input',
  },
  'input:datetime': {
    label: 'input:datetime',
    snippet: '<input type="datetime-local" name="${1:}" id="${2:}">',
    detail: 'Datetime-local input',
  },
  'input:time': {
    label: 'input:time',
    snippet: '<input type="time" name="${1:}" id="${2:}">',
    detail: 'Time input',
  },
  'input:color': {
    label: 'input:color',
    snippet: '<input type="color" name="${1:}" id="${2:}" value="${3:#000000}">',
    detail: 'Color input',
  },
  'input:file': {
    label: 'input:file',
    snippet: '<input type="file" name="${1:}" id="${2:}" accept="${3:}">',
    detail: 'File input',
  },
  'input:hidden': {
    label: 'input:hidden',
    snippet: '<input type="hidden" name="${1:}" value="${2:}">',
    detail: 'Hidden input',
  },
  'input:search': {
    label: 'input:search',
    snippet: '<input type="search" name="${1:}" id="${2:}" placeholder="${3:Search...}">',
    detail: 'Search input',
  },
  'input:reset': {
    label: 'input:reset',
    snippet: '<input type="reset" value="${1:Reset}">',
    detail: 'Reset input',
  },
  // ── Form Elements ──
  'btn': {
    label: 'btn',
    snippet: '<button type="${1:button}">${2:Click me}</button>',
    detail: 'Button element',
  },
  'btn:s': {
    label: 'btn:s',
    snippet: '<button type="submit">${1:Submit}</button>',
    detail: 'Submit button',
  },
  'btn:r': {
    label: 'btn:r',
    snippet: '<button type="reset">${1:Reset}</button>',
    detail: 'Reset button',
  },
  'btn:d': {
    label: 'btn:d',
    snippet: '<button type="button" disabled>${1:Disabled}</button>',
    detail: 'Disabled button',
  },
  'form:get': {
    label: 'form:get',
    snippet: '<form action="${1:}" method="get">\n\t$0\n</form>',
    detail: 'GET form',
  },
  'form:post': {
    label: 'form:post',
    snippet: '<form action="${1:}" method="post">\n\t$0\n</form>',
    detail: 'POST form',
  },
  'form:upload': {
    label: 'form:upload',
    snippet: '<form action="${1:}" method="post" enctype="multipart/form-data">\n\t$0\n</form>',
    detail: 'Upload form',
  },
  'select': {
    label: 'select',
    snippet: '<select name="${1:}" id="${2:}">\n\t<option value="${3:}">${4:Option}</option>\n\t$0\n</select>',
    detail: 'Select element',
  },
  'textarea': {
    label: 'textarea',
    snippet: '<textarea name="${1:}" id="${2:}" cols="${3:30}" rows="${4:10}">${5:}</textarea>',
    detail: 'Textarea element',
  },
  'fieldset': {
    label: 'fieldset',
    snippet: '<fieldset>\n\t<legend>${1:Legend}</legend>\n\t$0\n</fieldset>',
    detail: 'Fieldset with legend',
  },
  'label': {
    label: 'label',
    snippet: '<label for="${1:}">${2:Label}</label>',
    detail: 'Label element',
  },
  'optgroup': {
    label: 'optgroup',
    snippet: '<optgroup label="${1:Group}">\n\t<option value="${2:}">${3:Option}</option>\n\t$0\n</optgroup>',
    detail: 'Optgroup element',
  },
  'datalist': {
    label: 'datalist',
    snippet: '<datalist id="${1:}">\n\t<option value="${2:}">\n\t$0\n</datalist>',
    detail: 'Datalist element',
  },
  'output': {
    label: 'output',
    snippet: '<output for="${1:}" name="${2:}">${3:}</output>',
    detail: 'Output element',
  },
  'progress': {
    label: 'progress',
    snippet: '<progress value="${1:0}" max="${2:100}">${3:}</progress>',
    detail: 'Progress element',
  },
  'meter': {
    label: 'meter',
    snippet: '<meter value="${1:50}" min="${2:0}" max="${3:100}">${4:}</meter>',
    detail: 'Meter element',
  },
  // ── Table Patterns ──
  'table': {
    label: 'table',
    snippet: '<table>\n\t<thead>\n\t\t<tr>\n\t\t\t<th>${1:Header}</th>\n\t\t\t$0\n\t\t</tr>\n\t</thead>\n\t<tbody>\n\t\t<tr>\n\t\t\t<td>${2:Data}</td>\n\t\t</tr>\n\t</tbody>\n</table>',
    detail: 'Table with thead and tbody',
  },
  'table:full': {
    label: 'table:full',
    snippet: '<table>\n\t<caption>${1:Table Caption}</caption>\n\t<thead>\n\t\t<tr>\n\t\t\t<th>${2:Header}</th>\n\t\t</tr>\n\t</thead>\n\t<tbody>\n\t\t<tr>\n\t\t\t<td>${3:Data}</td>\n\t\t</tr>\n\t</tbody>\n\t<tfoot>\n\t\t<tr>\n\t\t\t<td>${4:Footer}</td>\n\t\t</tr>\n\t</tfoot>\n</table>',
    detail: 'Full table with caption, thead, tbody, tfoot',
  },
  'caption': {
    label: 'caption',
    snippet: '<caption>${1:Table Caption}</caption>',
    detail: 'Table caption',
  },
  'colgroup': {
    label: 'colgroup',
    snippet: '<colgroup>\n\t<col span="${1:1}">\n\t$0\n</colgroup>',
    detail: 'Colgroup with col',
  },
  // ── Semantic Sections ──
  'header': {
    label: 'header',
    snippet: '<header>\n\t$0\n</header>',
    detail: 'Header section',
  },
  'footer': {
    label: 'footer',
    snippet: '<footer>\n\t$0\n</footer>',
    detail: 'Footer section',
  },
  'main': {
    label: 'main',
    snippet: '<main>\n\t$0\n</main>',
    detail: 'Main section',
  },
  'nav': {
    label: 'nav',
    snippet: '<nav>\n\t$0\n</nav>',
    detail: 'Nav section',
  },
  'section': {
    label: 'section',
    snippet: '<section>\n\t$0\n</section>',
    detail: 'Section element',
  },
  'article': {
    label: 'article',
    snippet: '<article>\n\t$0\n</article>',
    detail: 'Article element',
  },
  'aside': {
    label: 'aside',
    snippet: '<aside>\n\t$0\n</aside>',
    detail: 'Aside element',
  },
  'figure': {
    label: 'figure',
    snippet: '<figure>\n\t${1:<img src="" alt="">}\n\t<figcaption>${2:Caption}</figcaption>\n</figure>',
    detail: 'Figure with figcaption',
  },
  'details': {
    label: 'details',
    snippet: '<details>\n\t<summary>${1:Summary}</summary>\n\t${2:Content}\n</details>',
    detail: 'Details with summary',
  },
  'dialog': {
    label: 'dialog',
    snippet: '<dialog id="${1:dialog}">\n\t$0\n</dialog>',
    detail: 'Dialog element',
  },
  'template': {
    label: 'template',
    snippet: '<template id="${1:}">\n\t$0\n</template>',
    detail: 'Template element',
  },
  'slot': {
    label: 'slot',
    snippet: '<slot name="${1:}">${2:Fallback}</slot>',
    detail: 'Slot element',
  },
  // ── Common Patterns ──
  'nav>ul>li*5>a': {
    label: 'nav>ul>li*5>a',
    snippet: '<nav>\n\t<ul>\n\t\t<li><a href="${1:}">${2:Link 1}</a></li>\n\t\t<li><a href="${3:}">${4:Link 2}</a></li>\n\t\t<li><a href="${5:}">${6:Link 3}</a></li>\n\t\t<li><a href="${7:}">${8:Link 4}</a></li>\n\t\t<li><a href="${9:}">${10:Link 5}</a></li>\n\t</ul>\n</nav>',
    detail: 'Navigation with 5 links',
  },
  'div.container>div.row>div.col*3': {
    label: 'div.container>div.row>div.col*3',
    snippet: '<div class="container">\n\t<div class="row">\n\t\t<div class="col">$1</div>\n\t\t<div class="col">$2</div>\n\t\t<div class="col">$3</div>\n\t</div>\n</div>',
    detail: 'Container > Row > 3 Columns',
  },
  'ul>li*5': {
    label: 'ul>li*5',
    snippet: '<ul>\n\t<li>$1</li>\n\t<li>$2</li>\n\t<li>$3</li>\n\t<li>$4</li>\n\t<li>$5</li>\n</ul>',
    detail: 'Unordered list with 5 items',
  },
  'ol>li*5': {
    label: 'ol>li*5',
    snippet: '<ol>\n\t<li>$1</li>\n\t<li>$2</li>\n\t<li>$3</li>\n\t<li>$4</li>\n\t<li>$5</li>\n</ol>',
    detail: 'Ordered list with 5 items',
  },
  'dl>dt+dd': {
    label: 'dl>dt+dd',
    snippet: '<dl>\n\t<dt>${1:Term}</dt>\n\t<dd>${2:Definition}</dd>\n</dl>',
    detail: 'Definition list',
  },
  'ul.nav>li.nav-item*5>a.nav-link': {
    label: 'ul.nav>li.nav-item*5>a.nav-link',
    snippet: '<ul class="nav">\n\t<li class="nav-item"><a class="nav-link" href="${1:}">${2:Link 1}</a></li>\n\t<li class="nav-item"><a class="nav-link" href="${3:}">${4:Link 2}</a></li>\n\t<li class="nav-item"><a class="nav-link" href="${5:}">${6:Link 3}</a></li>\n\t<li class="nav-item"><a class="nav-link" href="${7:}">${8:Link 4}</a></li>\n\t<li class="nav-item"><a class="nav-link" href="${9:}">${10:Link 5}</a></li>\n</ul>',
    detail: 'Navigation with nav-items',
  },
  'div.card': {
    label: 'div.card',
    snippet: '<div class="card">\n\t<div class="card-header">${1:Header}</div>\n\t<div class="card-body">\n\t\t<h5 class="card-title">${2:Title}</h5>\n\t\t<p class="card-text">${3:Text}</p>\n\t</div>\n</div>',
    detail: 'Card component',
  },
  'div.modal': {
    label: 'div.modal',
    snippet: '<div class="modal" id="${1:modal}">\n\t<div class="modal-dialog">\n\t\t<div class="modal-content">\n\t\t\t<div class="modal-header">\n\t\t\t\t<h5 class="modal-title">${2:Title}</h5>\n\t\t\t</div>\n\t\t\t<div class="modal-body">\n\t\t\t\t$0\n\t\t\t</div>\n\t\t\t<div class="modal-footer">\n\t\t\t\t<button>${3:Close}</button>\n\t\t\t</div>\n\t\t</div>\n\t</div>\n</div>',
    detail: 'Modal component',
  },
  'form:login': {
    label: 'form:login',
    snippet: '<form action="${1:}" method="post">\n\t<label for="email">Email</label>\n\t<input type="email" name="email" id="email" required>\n\t<label for="password">Password</label>\n\t<input type="password" name="password" id="password" required>\n\t<button type="submit">Log In</button>\n</form>',
    detail: 'Login form pattern',
  },
  'form:search': {
    label: 'form:search',
    snippet: '<form action="${1:}" method="get" role="search">\n\t<input type="search" name="${2:q}" placeholder="${3:Search...}" aria-label="${4:Search}">\n\t<button type="submit">${5:Search}</button>\n</form>',
    detail: 'Search form pattern',
  },
  'form:contact': {
    label: 'form:contact',
    snippet: '<form action="${1:}" method="post">\n\t<label for="name">Name</label>\n\t<input type="text" name="name" id="name" required>\n\t<label for="email">Email</label>\n\t<input type="email" name="email" id="email" required>\n\t<label for="message">Message</label>\n\t<textarea name="message" id="message" rows="5" required></textarea>\n\t<button type="submit">Send</button>\n</form>',
    detail: 'Contact form pattern',
  },
  // ── ARIA / Accessibility ──
  'aria:nav': {
    label: 'aria:nav',
    snippet: '<nav aria-label="${1:Main navigation}">\n\t$0\n</nav>',
    detail: 'Accessible navigation',
  },
  'aria:alert': {
    label: 'aria:alert',
    snippet: '<div role="alert" aria-live="assertive">\n\t${1:Alert message}\n</div>',
    detail: 'Alert region',
  },
  'aria:status': {
    label: 'aria:status',
    snippet: '<div role="status" aria-live="polite">\n\t${1:Status message}\n</div>',
    detail: 'Status region',
  },
  'sr-only': {
    label: 'sr-only',
    snippet: '<span class="sr-only">${1:Screen reader text}</span>',
    detail: 'Screen-reader-only text',
  },
  // ── Misc ──
  'lorem': {
    label: 'lorem',
    snippet: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    detail: 'Lorem ipsum text',
  },
  'lorem:s': {
    label: 'lorem:s',
    snippet: 'Lorem ipsum dolor sit amet.',
    detail: 'Short lorem ipsum',
  },
  'lorem:p': {
    label: 'lorem:p',
    snippet: '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>',
    detail: 'Lorem ipsum paragraph',
  },
  'comment': {
    label: 'comment',
    snippet: '<!-- ${1:TODO: } -->',
    detail: 'HTML comment',
  },
  'cc:ie': {
    label: 'cc:ie',
    snippet: '<!--[if IE]>\n\t${1:}\n<![endif]-->',
    detail: 'IE conditional comment',
  },
}

// ── Emmet Pattern Parsers ───────────────────────────────────────────────────

/** Monaco has no '*react' language ids: .tsx/.jsx models are 'typescript'/'javascript', so the file name decides. */
function isJsxModel(model: editor.ITextModel): boolean {
  return /\.[jt]sx$/i.test(model.uri.path)
}

function expandTag(tag: string, selfClosing: boolean, isJsx: boolean): string {
  if (selfClosing) {
    return isJsx ? `<${tag} $0/>` : `<${tag} $0>`
  }
  return `<${tag}>$0</${tag}>`
}

// ── Advanced Emmet AST Parser ───────────────────────────────────────────────

interface EmmetNode {
  tag: string
  id: string
  classes: string[]
  attrs: Record<string, string>
  text: string
  multiply: number
  children: EmmetNode[]
  siblings: EmmetNode[]
}

function createEmptyNode(): EmmetNode {
  return { tag: 'div', id: '', classes: [], attrs: {}, text: '', multiply: 1, children: [], siblings: [] }
}

/**
 * Parse a single element token like: tag#id.class1.class2[attr1=val attr2]{text}*N
 */
function parseElementToken(token: string): EmmetNode | null {
  const node = createEmptyNode()

  let rest = token.trim()
  if (!rest) return null

  // Extract multiplication *N
  const mulMatch = rest.match(/\*(\d+)$/)
  if (mulMatch) {
    node.multiply = Math.min(parseInt(mulMatch[1], 10), 20)
    rest = rest.slice(0, -mulMatch[0].length)
  }

  // Extract text content {text}
  const textMatch = rest.match(/\{([^}]*)\}$/)
  if (textMatch) {
    node.text = textMatch[1]
    rest = rest.slice(0, -textMatch[0].length)
  }

  // Extract attributes [attr1=val attr2="val"]
  const attrMatch = rest.match(/\[([^\]]*)\]$/)
  if (attrMatch) {
    const attrStr = attrMatch[1]
    // Parse key=value or key="value" pairs
    const attrRegex = /([a-zA-Z_-][a-zA-Z0-9_-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?/g
    let am: RegExpExecArray | null
    while ((am = attrRegex.exec(attrStr)) !== null) {
      node.attrs[am[1]] = am[2] ?? am[3] ?? am[4] ?? am[1]
    }
    rest = rest.slice(0, -attrMatch[0].length)
  }

  // Parse tag, id, classes
  const elemMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9-]*)?((?:[.#][a-zA-Z_-][a-zA-Z0-9_-]*)*)$/)
  if (!elemMatch) return null

  const tagPart = elemMatch[1]
  const modPart = elemMatch[2] || ''

  // If no tag specified but has modifiers, default to div
  if (tagPart) {
    node.tag = tagPart
  } else if (modPart) {
    node.tag = 'div'
  } else {
    return null
  }

  // Parse classes and id from modifiers
  if (modPart) {
    const modRegex = /([.#])([a-zA-Z_-][a-zA-Z0-9_-]*)/g
    let mm: RegExpExecArray | null
    while ((mm = modRegex.exec(modPart)) !== null) {
      if (mm[1] === '.') node.classes.push(mm[2])
      else if (mm[1] === '#') node.id = mm[2]
    }
  }

  return node
}

/**
 * Tokenize an Emmet abbreviation respecting grouping parentheses.
 * Returns an array of tokens split by operators (+, >, ^) at the top level.
 */
interface TokenizedExpr {
  type: 'element' | 'group'
  value: string       // raw text for element, inner for group
  operator: string    // the operator before this token ('' for first, '>', '+', '^')
  multiply: number
}

function tokenizeEmmet(abbr: string): TokenizedExpr[] | null {
  const tokens: TokenizedExpr[] = []
  let i = 0
  let currentOp = ''

  while (i < abbr.length) {
    // Skip leading operator
    if (i > 0 || abbr[i] === '+' || abbr[i] === '>' || abbr[i] === '^') {
      if (abbr[i] === '+' || abbr[i] === '>' || abbr[i] === '^') {
        currentOp = abbr[i]
        i++
        continue
      }
    }

    if (abbr[i] === '(') {
      // Group
      let depth = 1
      let j = i + 1
      while (j < abbr.length && depth > 0) {
        if (abbr[j] === '(') depth++
        else if (abbr[j] === ')') depth--
        j++
      }
      if (depth !== 0) return null  // unbalanced

      const inner = abbr.slice(i + 1, j - 1)
      let mul = 1
      // Check for *N after group
      const afterGroup = abbr.slice(j)
      const mulM = afterGroup.match(/^\*(\d+)/)
      if (mulM) {
        mul = Math.min(parseInt(mulM[1], 10), 20)
        j += mulM[0].length
      }

      tokens.push({ type: 'group', value: inner, operator: currentOp || '>', multiply: mul })
      currentOp = ''
      i = j
    } else {
      // Element token - read until next top-level operator or group
      let j = i
      let braceDepth = 0
      let bracketDepth = 0
      while (j < abbr.length) {
        const ch = abbr[j]
        if (ch === '{') braceDepth++
        else if (ch === '}') braceDepth--
        else if (ch === '[') bracketDepth++
        else if (ch === ']') bracketDepth--
        else if (braceDepth === 0 && bracketDepth === 0) {
          if (ch === '+' || ch === '>' || ch === '^' || ch === '(') break
        }
        j++
      }

      const elemStr = abbr.slice(i, j)
      if (elemStr) {
        tokens.push({ type: 'element', value: elemStr, operator: currentOp || '>', multiply: 1 })
        currentOp = ''
      }
      i = j
    }
  }

  return tokens.length > 0 ? tokens : null
}

/**
 * Render an EmmetNode to an HTML snippet string.
 */
function renderNode(node: EmmetNode, isJsx: boolean, indent: string, tabStopCounter: { n: number }): string {
  const classAttr = isJsx ? 'className' : 'class'
  const lines: string[] = []

  for (let rep = 0; rep < node.multiply; rep++) {
    // Replace $ numbering with current iteration (1-based)
    const idx = rep + 1
    const resolveNumbering = (s: string) => s.replace(/\$/g, String(idx))

    let attrs = ''
    if (node.id) attrs += ` id="${resolveNumbering(node.id)}"`
    if (node.classes.length > 0) {
      attrs += ` ${classAttr}="${node.classes.map(c => resolveNumbering(c)).join(' ')}"`
    }
    for (const [k, v] of Object.entries(node.attrs)) {
      attrs += ` ${k}="${resolveNumbering(v)}"`
    }

    const selfClosing = SELF_CLOSING_TAGS.has(node.tag)
    const resolvedTag = resolveNumbering(node.tag)

    if (selfClosing) {
      const line = isJsx
        ? `${indent}<${resolvedTag}${attrs} />`
        : `${indent}<${resolvedTag}${attrs}>`
      lines.push(line)
    } else {
      const hasChildren = node.children.length > 0
      const text = node.text ? resolveNumbering(node.text) : ''

      if (hasChildren) {
        lines.push(`${indent}<${resolvedTag}${attrs}>`)
        for (const child of node.children) {
          lines.push(renderNode(child, isJsx, indent + '\t', tabStopCounter))
          // Render child siblings
          for (const sib of child.siblings) {
            lines.push(renderNode(sib, isJsx, indent + '\t', tabStopCounter))
          }
        }
        lines.push(`${indent}</${resolvedTag}>`)
      } else if (text) {
        lines.push(`${indent}<${resolvedTag}${attrs}>${text}</${resolvedTag}>`)
      } else {
        const stop = `$${tabStopCounter.n++}`
        lines.push(`${indent}<${resolvedTag}${attrs}>${stop}</${resolvedTag}>`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Full Emmet abbreviation expansion supporting:
 * - Nesting (>), sibling (+), climb-up (^), grouping (())
 * - Multiplication (*N), numbering ($), class/id, attributes, text
 */
function expandFullAbbreviation(abbr: string, isJsx: boolean): { snippet: string; detail: string } | null {
  // Must contain at least one Emmet operator or modifier to trigger full parse
  if (!/[>+^()*#.\[\]{}]/.test(abbr)) return null
  // Quick sanity: must start with valid char
  if (!/^[a-zA-Z.#(]/.test(abbr)) return null

  try {
    const tree = buildTree(abbr, isJsx)
    if (!tree || tree.length === 0) return null

    const counter = { n: 1 }
    const rendered = tree.map(n => {
      let result = renderNode(n, isJsx, '', counter)
      for (const sib of n.siblings) {
        result += '\n' + renderNode(sib, isJsx, '', counter)
      }
      return result
    }).join('\n')

    if (!rendered.trim()) return null

    // Build a short detail string
    const detail = abbr.length > 40 ? abbr.slice(0, 37) + '...' : abbr
    return { snippet: rendered, detail: `Emmet: ${detail}` }
  } catch {
    return null
  }
}

function buildTree(abbr: string, isJsx: boolean): EmmetNode[] | null {
  const tokens = tokenizeEmmet(abbr)
  if (!tokens) return null

  // Build tree from tokens
  const roots: EmmetNode[] = []
  let currentParent: EmmetNode | null = null
  let currentNode: EmmetNode | null = null
  const parentStack: EmmetNode[] = []

  for (const token of tokens) {
    let newNodes: EmmetNode[]

    if (token.type === 'group') {
      // Recursively build the group
      const groupTree = buildTree(token.value, isJsx)
      if (!groupTree || groupTree.length === 0) return null

      // Apply multiplication to the group
      if (token.multiply > 1) {
        const allNodes: EmmetNode[] = []
        for (let i = 0; i < token.multiply; i++) {
          // Deep clone the group tree for each multiplication
          const cloned = JSON.parse(JSON.stringify(groupTree)) as EmmetNode[]
          allNodes.push(...cloned)
        }
        newNodes = allNodes
      } else {
        newNodes = groupTree
      }
    } else {
      const parsed = parseElementToken(token.value)
      if (!parsed) return null
      // Validate tag is known or is a custom element or has modifiers
      if (!HTML_TAGS.includes(parsed.tag) && !parsed.tag.includes('-') &&
          parsed.classes.length === 0 && !parsed.id && Object.keys(parsed.attrs).length === 0) {
        return null
      }
      newNodes = [parsed]
    }

    const firstNew = newNodes[0]

    switch (token.operator) {
      case '>': // child
        if (currentNode) {
          parentStack.push(currentNode)
          currentParent = currentNode
          currentParent.children.push(firstNew)
          for (let i = 1; i < newNodes.length; i++) {
            firstNew.siblings.push(newNodes[i])
          }
        } else {
          roots.push(firstNew)
          for (let i = 1; i < newNodes.length; i++) {
            firstNew.siblings.push(newNodes[i])
          }
        }
        currentNode = newNodes[newNodes.length - 1]
        break

      case '+': // sibling
        if (currentParent) {
          for (const nn of newNodes) {
            currentParent.children.push(nn)
          }
        } else {
          for (const nn of newNodes) {
            roots.push(nn)
          }
        }
        currentNode = newNodes[newNodes.length - 1]
        break

      case '^': // climb up
        if (parentStack.length > 0) {
          parentStack.pop()
          currentParent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null
        } else {
          currentParent = null
        }
        if (currentParent) {
          for (const nn of newNodes) {
            currentParent.children.push(nn)
          }
        } else {
          for (const nn of newNodes) {
            roots.push(nn)
          }
        }
        currentNode = newNodes[newNodes.length - 1]
        break

      default: // first token
        roots.push(firstNew)
        for (let i = 1; i < newNodes.length; i++) {
          firstNew.siblings.push(newNodes[i])
        }
        currentNode = newNodes[newNodes.length - 1]
        break
    }
  }

  return roots
}

/**
 * Expand a tag abbreviation with class/id: div.foo#bar -> <div class="foo" id="bar"></div>
 */
function expandTagWithModifiers(abbr: string, isJsx: boolean): { snippet: string; detail: string } | null {
  const match = abbr.match(/^([a-zA-Z][a-zA-Z0-9-]*)((?:[.#][a-zA-Z_-][a-zA-Z0-9_-]*)*)$/)
  if (!match) return null

  const tag = match[1]
  const modifiers = match[2]
  if (!modifiers) return null

  // Only expand known tags or custom elements with modifiers
  if (!HTML_TAGS.includes(tag) && !tag.includes('-')) return null

  const classes: string[] = []
  let id = ''

  const modRegex = /([.#])([a-zA-Z_-][a-zA-Z0-9_-]*)/g
  let m: RegExpExecArray | null
  while ((m = modRegex.exec(modifiers)) !== null) {
    if (m[1] === '.') classes.push(m[2])
    else if (m[1] === '#') id = m[2]
  }

  const classAttr = isJsx ? 'className' : 'class'
  let attrs = ''
  if (id) attrs += ` id="${id}"`
  if (classes.length > 0) attrs += ` ${classAttr}="${classes.join(' ')}"`

  const selfClosing = SELF_CLOSING_TAGS.has(tag)
  if (selfClosing) {
    const snippet = isJsx ? `<${tag}${attrs} $0/>` : `<${tag}${attrs} $0>`
    return { snippet, detail: snippet.replace(/\$\d/g, '') }
  }

  const snippet = `<${tag}${attrs}>$0</${tag}>`
  return { snippet, detail: snippet.replace(/\$\d/g, '') }
}

/**
 * Expand implicit tag abbreviation (no tag name, just classes/id): .foo#bar -> <div class="foo" id="bar"></div>
 */
function expandImplicitTag(abbr: string, isJsx: boolean): { snippet: string; detail: string } | null {
  if (!/^[.#]/.test(abbr)) return null
  const match = abbr.match(/^((?:[.#][a-zA-Z_-][a-zA-Z0-9_-]*)*)$/)
  if (!match || !match[1]) return null

  const classes: string[] = []
  let id = ''
  const modRegex = /([.#])([a-zA-Z_-][a-zA-Z0-9_-]*)/g
  let m: RegExpExecArray | null
  while ((m = modRegex.exec(match[1])) !== null) {
    if (m[1] === '.') classes.push(m[2])
    else if (m[1] === '#') id = m[2]
  }

  if (classes.length === 0 && !id) return null

  const classAttr = isJsx ? 'className' : 'class'
  let attrs = ''
  if (id) attrs += ` id="${id}"`
  if (classes.length > 0) attrs += ` ${classAttr}="${classes.join(' ')}"`

  const snippet = `<div${attrs}>$0</div>`
  return { snippet, detail: snippet.replace(/\$\d/g, '') }
}

/**
 * Expand multiply abbreviation: li*3 -> <li></li><li></li><li></li>
 */
function expandMultiply(abbr: string, isJsx: boolean): { snippet: string; detail: string } | null {
  const match = abbr.match(/^([a-zA-Z][a-zA-Z0-9-]*)\*(\d+)$/)
  if (!match) return null

  const tag = match[1]
  const count = parseInt(match[2], 10)

  if (!HTML_TAGS.includes(tag) && !tag.includes('-')) return null
  if (count < 1 || count > 20) return null

  const selfClosing = SELF_CLOSING_TAGS.has(tag)
  const lines: string[] = []

  for (let i = 0; i < count; i++) {
    if (selfClosing) {
      lines.push(isJsx ? `<${tag} />` : `<${tag}>`)
    } else {
      lines.push(`<${tag}>$${i + 1}</${tag}>`)
    }
  }

  const snippet = lines.join('\n')
  const detail = `${count}x <${tag}>`
  return { snippet, detail }
}

/**
 * Expand numeric CSS abbreviations: m0 -> margin: 0, p10 -> padding: 10px, w100 -> width: 100%
 */
function expandNumericCSS(abbr: string): { snippet: string; detail: string } | null {
  const match = abbr.match(/^(m|mt|mr|mb|ml|mx|my|p|pt|pr|pb|pl|px|py|w|h|mw|mh|miw|mih|minw|minh|fz|lh|t|r|b|l|gap|br|z|op)(\d+)(p|e|r|%)?$/)
  if (!match) return null

  const prop = match[1]
  const num = match[2]
  const unitSuffix = match[3]

  const propMap: Record<string, string> = {
    m: 'margin', mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left',
    p: 'padding', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left',
    w: 'width', h: 'height', mw: 'max-width', mh: 'max-height',
    miw: 'min-width', mih: 'min-height', minw: 'min-width', minh: 'min-height',
    fz: 'font-size', lh: 'line-height',
    t: 'top', r: 'right', b: 'bottom', l: 'left',
    gap: 'gap', br: 'border-radius', z: 'z-index', op: 'opacity',
  }

  const cssProperty = propMap[prop]
  if (!cssProperty) return null

  let unit = 'px'
  if (unitSuffix === 'p' || unitSuffix === '%') unit = '%'
  else if (unitSuffix === 'e') unit = 'em'
  else if (unitSuffix === 'r') unit = 'rem'

  // Special cases
  if (num === '0') {
    const snippet = `${cssProperty}: 0;`
    return { snippet, detail: snippet }
  }
  if (prop === 'z' || prop === 'op' || prop === 'lh') {
    // These are unitless
    const val = prop === 'op' ? (parseInt(num) / 100).toString() : num
    const snippet = `${cssProperty}: ${val};`
    return { snippet, detail: snippet }
  }

  // Handle mx/my expansion
  if (prop === 'mx') {
    const snippet = `margin-left: ${num}${unit};\nmargin-right: ${num}${unit};`
    return { snippet, detail: `margin-left + margin-right: ${num}${unit}` }
  }
  if (prop === 'my') {
    const snippet = `margin-top: ${num}${unit};\nmargin-bottom: ${num}${unit};`
    return { snippet, detail: `margin-top + margin-bottom: ${num}${unit}` }
  }
  if (prop === 'px') {
    const snippet = `padding-left: ${num}${unit};\npadding-right: ${num}${unit};`
    return { snippet, detail: `padding-left + padding-right: ${num}${unit}` }
  }
  if (prop === 'py') {
    const snippet = `padding-top: ${num}${unit};\npadding-bottom: ${num}${unit};`
    return { snippet, detail: `padding-top + padding-bottom: ${num}${unit}` }
  }

  // Width/height with 100 -> 100%
  if ((prop === 'w' || prop === 'h') && num === '100' && !unitSuffix) {
    unit = '%'
  }

  const snippet = `${cssProperty}: ${num}${unit};`
  return { snippet, detail: snippet }
}

/**
 * Wrap selected text with an Emmet abbreviation.
 * The selected text lines are placed inside the innermost element.
 */
function findDeepestNode(nodes: EmmetNode[]): EmmetNode {
  const last = nodes[nodes.length - 1]
  if (last.children.length > 0) return findDeepestNode(last.children)
  return last
}

function wrapWithAbbreviation(abbr: string, selectedText: string, isJsx: boolean): string | null {
  // Parse the abbreviation into a tree
  try {
    const tree = buildTree(abbr, isJsx)
    if (!tree || tree.length === 0) return null

    const deepest = findDeepestNode(tree)
    // Set the text of the deepest node to the selected text
    deepest.text = selectedText

    const counter = { n: 1 }
    return tree.map(n => renderNode(n, isJsx, '', counter)).join('\n')
  } catch {
    return null
  }
}

// ── Languages to register ───────────────────────────────────────────────────

const HTML_LANGUAGES = ['html', 'javascript', 'typescript']
const CSS_LANGUAGES = ['css', 'scss', 'less']
const ALL_LANGUAGES = [...HTML_LANGUAGES, ...CSS_LANGUAGES]

// ── Provider Registration ───────────────────────────────────────────────────

function createEmmetCompletionProvider(monaco: Monaco): languages.CompletionItemProvider {
  return {
    triggerCharacters: ['>', '*', '.', '#', '!', ':', '+', '^', ')', ']', '}', '$'],

    provideCompletionItems(model, position) {
      const lineContent = model.getLineContent(position.lineNumber)
      const textUntilPosition = lineContent.substring(0, position.column - 1)

      // Extract the abbreviation: go back from cursor to find the emmet expression
      // Extended regex to capture grouping, attributes, text content, numbering
      const abbrMatch = textUntilPosition.match(/([a-zA-Z!.#][a-zA-Z0-9.#>*+^:\-$@()\[\]{}|]*)$/)
      if (!abbrMatch) return { suggestions: [] }

      const abbr = abbrMatch[1]
      if (abbr.length < 1) return { suggestions: [] }

      const langId = model.getLanguageId()
      const isHTML = HTML_LANGUAGES.includes(langId)
      const isCSS = CSS_LANGUAGES.includes(langId)
      const isJsx = isJsxModel(model)

      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column - abbr.length,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }

      const suggestions: languages.CompletionItem[] = []
      const CompletionItemKind = monaco.languages.CompletionItemKind
      const InsertTextRule = (monaco.editor as any).CompletionItemInsertTextRule ?? (monaco as any).languages?.CompletionItemInsertTextRule

      // Helper to get InsertAsSnippet
      const snippetRule = InsertTextRule?.InsertAsSnippet ?? 4

      // ── HTML Snippet Shortcuts ────────────────────────────────────
      if (isHTML) {
        // Written as HTML (class=, for=, unclosed <img>): not valid JSX.
        for (const [key, value] of isJsx ? [] : Object.entries(HTML_SNIPPETS)) {
          if (key.startsWith(abbr) || key === abbr) {
            suggestions.push({
              label: `\u26A1 ${value.label}`,
              kind: CompletionItemKind.Snippet,
              documentation: value.detail,
              insertText: value.snippet,
              insertTextRules: snippetRule,
              range,
              sortText: '0' + key,
              detail: 'Emmet',
            })
          }
        }

        // ── Plain tag abbreviation ────────────────────────────────────
        if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(abbr)) {
          for (const tag of HTML_TAGS) {
            if (tag.startsWith(abbr)) {
              const selfClosing = SELF_CLOSING_TAGS.has(tag)
              suggestions.push({
                label: `\u26A1 ${tag}`,
                kind: CompletionItemKind.Snippet,
                documentation: `Emmet: <${tag}>`,
                insertText: expandTag(tag, selfClosing, isJsx),
                insertTextRules: snippetRule,
                range,
                sortText: '1' + tag,
                detail: 'Emmet',
              })
            }
          }
        }

        // ── Tag with class/id (div.foo, span#bar) ────────────────────
        const modResult = expandTagWithModifiers(abbr, isJsx)
        if (modResult) {
          suggestions.push({
            label: `\u26A1 ${abbr}`,
            kind: CompletionItemKind.Snippet,
            documentation: modResult.detail,
            insertText: modResult.snippet,
            insertTextRules: snippetRule,
            range,
            sortText: '0' + abbr,
            detail: 'Emmet',
          })
        }

        // ── Implicit tag (.foo, #bar -> div) ────────────────────────
        const implicitResult = expandImplicitTag(abbr, isJsx)
        if (implicitResult) {
          suggestions.push({
            label: `\u26A1 ${abbr}`,
            kind: CompletionItemKind.Snippet,
            documentation: implicitResult.detail,
            insertText: implicitResult.snippet,
            insertTextRules: snippetRule,
            range,
            sortText: '0' + abbr,
            detail: 'Emmet',
          })
        }

        // ── Simple Multiply (li*3) ──────────────────────────────────
        const multiplyResult = expandMultiply(abbr, isJsx)
        if (multiplyResult) {
          suggestions.push({
            label: `\u26A1 ${abbr}`,
            kind: CompletionItemKind.Snippet,
            documentation: multiplyResult.detail,
            insertText: multiplyResult.snippet,
            insertTextRules: snippetRule,
            range,
            sortText: '0' + abbr,
            detail: 'Emmet',
          })
        }

        // ── Full abbreviation expansion (nesting, siblings, grouping, climb-up) ──
        const fullResult = expandFullAbbreviation(abbr, isJsx)
        if (fullResult) {
          suggestions.push({
            label: `\u26A1 ${abbr}`,
            kind: CompletionItemKind.Snippet,
            documentation: fullResult.detail,
            insertText: fullResult.snippet,
            insertTextRules: snippetRule,
            range,
            sortText: '00' + abbr,
            detail: 'Emmet',
          })
        }
      }

      // ── CSS Abbreviations ───────────────────────────────────────────
      // CSS abbreviations work in both CSS files and HTML/JSX (for inline styles, CSS-in-JS)
      {
        // Static abbreviations
        for (const [key, value] of Object.entries(CSS_ABBREVIATIONS)) {
          if (key.startsWith(abbr) || key === abbr) {
            suggestions.push({
              label: `\u26A1 ${value.label}`,
              kind: CompletionItemKind.Snippet,
              documentation: value.detail,
              insertText: value.snippet,
              insertTextRules: snippetRule,
              range,
              sortText: (isCSS ? '0' : '2') + key,
              detail: 'Emmet CSS',
            })
          }
        }

        // Numeric CSS abbreviations (m0, p10, w100, etc.)
        const numericResult = expandNumericCSS(abbr)
        if (numericResult) {
          suggestions.push({
            label: `\u26A1 ${abbr}`,
            kind: CompletionItemKind.Snippet,
            documentation: numericResult.detail,
            insertText: numericResult.snippet,
            insertTextRules: snippetRule,
            range,
            sortText: (isCSS ? '0' : '2') + abbr,
            detail: 'Emmet CSS',
          })
        }
      }

      return { suggestions }
    },
  }
}

// ── Wrap With Abbreviation Action ───────────────────────────────────────────

function registerWrapWithAbbreviation(monaco: Monaco): IDisposable[] {
  const disposables: IDisposable[] = []

  // Register the wrap action for each editor that gets created
  const disposable = monaco.editor.onDidCreateEditor((editorInstance: editor.ICodeEditor) => {
    const actionDisposable = (editorInstance as any).addAction({
      id: 'emmet.wrapWithAbbreviation',
      label: 'Emmet: Wrap with Abbreviation',
      keybindings: [
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyA,
      ],
      precondition: 'editorHasSelection',
      run: (ed: editor.ICodeEditor) => {
        const selection = ed.getSelection()
        if (!selection) return

        const model = ed.getModel()
        const selectedText = model?.getValueInRange(selection)
        if (!model || !selectedText) return

        const isJsx = isJsxModel(model)

        // Use a quick input to ask for the abbreviation
        const inputEl = document.createElement('div')
        inputEl.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);z-index:100000;background:#1e1e1e;border:1px solid #454545;border-radius:6px;padding:12px;box-shadow:0 4px 16px rgba(0,0,0,0.4);'
        const labelEl = document.createElement('div')
        labelEl.textContent = 'Enter Emmet abbreviation to wrap with:'
        labelEl.style.cssText = 'color:#cccccc;font-size:13px;margin-bottom:8px;font-family:system-ui,sans-serif;'
        const input = document.createElement('input')
        input.type = 'text'
        input.placeholder = 'e.g. div.wrapper, ul>li'
        input.style.cssText = 'width:300px;padding:6px 10px;background:#2d2d2d;border:1px solid #555;border-radius:4px;color:#fff;font-size:14px;font-family:monospace;outline:none;'
        inputEl.appendChild(labelEl)
        inputEl.appendChild(input)
        document.body.appendChild(inputEl)
        input.focus()

        const cleanup = () => {
          if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl)
        }

        input.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            cleanup()
            ed.focus()
            return
          }
          if (e.key === 'Enter') {
            const abbrValue = input.value.trim()
            cleanup()
            if (!abbrValue) {
              ed.focus()
              return
            }

            const wrapped = wrapWithAbbreviation(abbrValue, selectedText, isJsx)
            if (wrapped) {
              ed.executeEdits('emmet-wrap', [{
                range: selection,
                text: wrapped,
                forceMoveMarkers: true,
              }])
            }
            ed.focus()
          }
        })

        input.addEventListener('blur', () => {
          // Small delay to allow Enter keydown to fire first
          setTimeout(cleanup, 200)
        })
      },
    })
    disposables.push(actionDisposable)
  })

  disposables.push(disposable)
  return disposables
}

// ── React Component ─────────────────────────────────────────────────────────

export default function EmmetProvider({ monaco }: EmmetProviderProps) {
  const disposablesRef = useRef<IDisposable[]>([])

  useEffect(() => {
    if (!monaco) return

    // Dispose previous registrations
    disposablesRef.current.forEach(d => d.dispose())
    disposablesRef.current = []

    const provider = createEmmetCompletionProvider(monaco)

    for (const langId of ALL_LANGUAGES) {
      const disposable = monaco.languages.registerCompletionItemProvider(langId, provider)
      disposablesRef.current.push(disposable)
    }

    // Register wrap-with-abbreviation action
    const wrapDisposables = registerWrapWithAbbreviation(monaco)
    disposablesRef.current.push(...wrapDisposables)

    return () => {
      disposablesRef.current.forEach(d => d.dispose())
      disposablesRef.current = []
    }
  }, [monaco])

  return null
}

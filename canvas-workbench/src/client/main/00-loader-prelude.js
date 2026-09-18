/**
 * @local/canvas-workbench — Client half (browser bundle)
 *
 * 通过 web 加载器 window.__ModuleLoader__.load 装载；require('react') 取应用
 * React。所有数据走同源 HTTP（/dsh-canvas/image、/dsh-canvas/state）。
 */
window.__ModuleLoader__.load({
  // The client module id must match the package id used by DSH's client
  // registry.  Using a different legacy id makes Desktop reject the bundle
  // during renderer boot and fall back to Recovery Mode.
  id: '@local/canvas-workbench',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // ---- React (single instance from the loader) ----
    var _react = require('react');
    var React = _react && _react.default ? _react.default : _react;


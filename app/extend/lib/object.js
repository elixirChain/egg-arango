'use strict';

function modifyValues(_obj, _fn) {
  return batch(_obj, (_acc, _cur) => {
    if (_cur[1]) {
      _acc[_cur[0]] = _fn(_cur[1]);
    }
  });
}

function batch(_obj, _fn) {
  return Object.entries(_obj).reduce((_acc, _cur) => {
    _fn(_acc, _cur);
    return _acc;
  }, {});
}

module.exports = {
  modifyValues,
  batch,
};

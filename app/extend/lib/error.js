'use strict';

// class Error {
//   constructor(message) {
//     this.message = message;
//     this.name = "Error"; // (different names for different built-in error classes)
//     this.stack = <nested calls>; // non-standard, but most environments support it
//   }
// }
class BaseError extends Error {
  constructor(code, message) {
    super(message);
    // this.msg = message; // this.message在egg-onerror配置中获取不到
    this.code = code;
    this.name = this.constructor.name;
  }
}

class BizError extends BaseError {
  constructor(message, code) {
    // code全部默认-1
    if (!code) {
      code = -1;
    }
    super(code, message);
  }
}

class SysError extends BaseError {
  constructor(message, code) {
    // code全部默认-1
    if (!code) {
      code = -1;
    }
    super(code, message);
  }
}

const errorCode = {
  DUPLICATE: 40050,
};

module.exports = { BizError, SysError, BaseError, errorCode };

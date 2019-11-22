'use strict';

// 大/小驼峰式转下划线
function underlineCase(str) {
  // testTest/TestTest => test_test
  let res = str.replace(/[A-Z]/g, s => '_' + s[0].toLowerCase());
  // 首字母大写
  if (res[0] === '_') {
    res = res.substring(1);
  }
  return res;
}

// 字母转小写
function lowerFirst(str) {
  return str[0].toLowerCase() + str.substring(1);
}

// 字母转大写
function upperFirst(str) {
  return str[0].toUpperCase() + str.substring(1);
}

// 小驼峰式
function lowerCamelize(str) {
  // test-test/test_test => testTest
  let res = str.replace(/[_-][a-z]/ig, s => s[1].toUpperCase());
  // user2role => user2Role
  res = res.replace(/[2][a-z]/ig, s => s[0] + s[1].toUpperCase());
  // 保证首字母为小写
  return lowerFirst(res);
}

// 大驼峰式（即帕斯卡命名法）
function upperCamelize(str) {
  // 小驼峰式
  const res = lowerCamelize(str);
  // 保证首字母为大写
  return upperFirst(res);
}

module.exports = {
  underlineCase,
  lowerFirst,
  upperFirst,
  lowerCamelize,
  upperCamelize,
};

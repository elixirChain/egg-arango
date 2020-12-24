# egg-arango

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![David deps][david-image]][david-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/egg-arango.svg?style=flat-square
[npm-url]: https://npmjs.org/package/egg-arango
[travis-image]: https://img.shields.io/travis/eggjs/egg-arango.svg?style=flat-square
[travis-url]: https://travis-ci.org/eggjs/egg-arango
[codecov-image]: https://img.shields.io/codecov/c/github/eggjs/egg-arango.svg?style=flat-square
[codecov-url]: https://codecov.io/github/eggjs/egg-arango?branch=master
[david-image]: https://img.shields.io/david/eggjs/egg-arango.svg?style=flat-square
[david-url]: https://david-dm.org/eggjs/egg-arango
[snyk-image]: https://snyk.io/test/npm/egg-arango/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/egg-arango
[download-image]: https://img.shields.io/npm/dm/egg-arango.svg?style=flat-square
[download-url]: https://npmjs.org/package/egg-arango

<!--
Description here.
-->

## 依赖说明

### 依赖的 egg 版本

egg-arango 版本 | egg 1.x
--- | ---
1.x | 😁
0.x | ❌

### 依赖的插件
<!--

如果有依赖其它插件，请在这里特别说明。如

- security
- multipart

-->

## 开启插件

```js
// config/plugin.js
exports.arango = {
  enable: true,
  package: 'egg-arango',
};
```

## 详细配置

```js
// {app_root}/config/config.default.js

exports.arango = {
  client: {
    url: [
      'http://127.0.0.1:8529',
    ],
    username: 'dba',
    password: 'psd',
    database: 'dbName',
  },
};
```

see [config/config.default.js](config/config.default.js) for more detail.

## 模板示例

- Controller

```js
const { BaseController } = require('egg-arango');
const Joi = require('joi');

/** doc插件 ctrl+shift+/ 快捷添加注释 */
class DemoController extends BaseController {
  /**
   * controller开发规范：参数校验，访问转发。
   *  - 不允许重写getServiceName；
   *  - 只能使用callService调用同名service的服务;
   *  - （默认使用）使用this.success处理响应结果;
   */

  async demo() {
    const { ctx, callService } = this;
    const result = await callService(
      'demo',
      ctx.request.body,
      Joi.object({
        name: Joi.string().required(),
      }).required()
    );
    ctx.body = this.success(result);
  }

}

module.exports = DemoController;
```

- Service

```js
const { BaseService } = require('egg-arango');

/** doc插件 ctrl+shift+/ 快捷添加注释 */
class DemoService extends BaseService {
  /**
   * service开发规范：具体业务逻辑，处理异常。
   *  - （默认不需要）可以通过重写getDaoName可以指定dao层服务；
   *  - 使用base方法，调用Dao层服务；
   *   - 或重写base方法，实现新业务逻辑（注意：不能通过this.func调用同名方法）；
   *   - 或调用多个dao组合复杂业务；
   *   - 或者调用第三方接口；
   */

  /**
    * 替换描述
    * @param {object} params 参数
    * @return {object} obj
    */
  async demo(params) {
    const { demo } = await this.get(params._id);
    if (demo && Object.keys(demo).length === 0) {
      throw this.BizError(`[${params._id}]不存在!`);
    }
    return { demo };
  }

}

module.exports = DemoService;
```

- Dao

```js
const { BaseDao } = require('egg-arango');

/** doc插件 ctrl+shift+/ 快捷添加注释 */
class DemoDao extends BaseDao {
  /**
   * 数据访问处理，基本文档查询参考 'BaseDao.md'。
   *  - （默认不需要）可以通过重写getCollectionName可以指定collection；
   *  - 和数据库collection一一对应；
   *  - 只包含collection的数据操作，不能含有业务逻辑；
   *  - 特殊情况再考虑使用自定义AQL调用this.query实现数据操作；
  */


}

module.exports = DemoDao;
```

## 单元测试

<!-- 描述如何在单元测试中使用此插件，例如 schedule 如何触发。无则省略。-->

## 提问交流

请到 [egg issues](https://github.com/eggjs/egg/issues) 异步交流。

## License

[MIT](LICENSE)

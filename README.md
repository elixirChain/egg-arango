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

## Install

```bash
$ npm i egg-arango --save
```

## Usage

```js
// {app_root}/config/plugin.js
exports.arango = {
  enable: true,
  package: 'egg-arango',
};
```

## Configuration

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

## Example

- Controller

```js
const { BaseController } = require('egg-arango');
const Joi = require('joi');

class DemoController extends BaseController {
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

class DemoService extends BaseService {
  /**
    * description
    * @param {object} params params
    * @return {object} obj
    */
  async demo(params) {
    const { demo } = await this.get(params._id);
    if (demo && Object.keys(demo).length === 0) {
      throw this.BizError(`[${params._id}] is not existed!`);
    }
    return { demo };
  }

}

module.exports = DemoService;
```

- Dao

```js
const { BaseDao } = require('egg-arango');

class DemoDao extends BaseDao {
}

module.exports = DemoDao;
```

## Questions & Suggestions

Please open an issue [here](https://github.com/eggjs/egg/issues).

## License

[MIT](LICENSE)

'use strict';

const path = require('path');
const { BaseError } = require('../app/extend/lib/error');

module.exports = appInfo => {
  const config = exports = {};

  // 共享变量
  // config.interfaceToken = {
  //   access_token: null,
  //   expire_date: null,
  // };

  // arangodb 配置
  config.arango = {
    app: true,
    agent: false,
    client: {
      url: 'http://localhost:8529',
      username: 'user',
      password: 'pwd',
      database: 'dbName',
    },
  };

  // 开发环境指定应用端口（默认7001，需修改为其他端口）
  config.cluster = {
    listen: {
      // port: 7001,
    },
  };

  // // ignoreURL
  // const ignoreURLs = [
  //   '/v1/api/test/*',
  //   '/v1/api/user/login',
  // ];

  // // 中间件配置 见目录‘/app/middleware’
  // config.middleware = [
  //   'verifyToken',
  //   'notFound',
  // ];

  // // 中间件配置
  // config.verifyToken = {
  //   // 不能同时配置match和ignore
  //   ignore: ignoreURLs,
  // };

  // use for cookie sign key, should change to your own and keep security
  config.keys = appInfo.name + '_1542819402672_5510';
  // TODO:禁用csrf
  config.security = {
    csrf: {
      enable: false,
      // match: [ '/index', '/login' ],
      // useSession: true, // 默认为 false，当设置为 true 时，将会把 csrf token 保存到 Session 中
      // cookieName: 'csrfToken', // Cookie 中的字段名，默认为 csrfToken
      // sessionName: 'csrfToken', // Session 中的字段名，默认为 csrfToken
    },
  };

  // cors 配置
  config.cors = {
    origin: '*',
    allowMethods: 'GET,POST',
  };

  // 日志级别：NONE，DEBUG，INFO，WARN 和 ERROR
  // 生产默认禁止使用 DEBUG 级别，若确实需要，则需同时设置allowDebugAtProd: true
  config.logger = {
    // 文件日志 默认INFO
    // level: 'DEBUG',
    // 控制台日志 默认INFO
    consoleLevel: 'DEBUG',
  };

  // swagger配置（默认配置，可覆盖；在使用插件的项目根目录增肌api.yml即可使用；）
  config.static = {
    maxAge: 31536000,
    prefix: '/',
    dir: path.join(appInfo.baseDir, 'app/assets'),
  };

  // 覆盖egg自带的配置 使支持接收xml参数
  config.bodyParser = {
    enable: true,
    encoding: 'utf8',
    formLimit: '100kb',
    jsonLimit: '100kb',
    strict: true,
    // @see https://github.com/hapijs/qs/blob/master/lib/parse.js#L8 for more options
    queryString: {
      arrayLimit: 100,
      depth: 5,
      parameterLimit: 1000,
    },
    enableTypes: [ 'json', 'form', 'text' ],
    extendTypes: {
      text: [ 'text/xml', 'application/xml' ],
    },
  };

  // onerror 主要处理全局异常，即未捕获异常
  function convertError(err) {
    // 默认
    let status = 500;
    let code = -1;
    if (err instanceof BaseError) {
    // 自定义业务code
      code = err.code;
      status = 200;
    }
    return {
      status,
      body: {
        code,
        name: err.name,
        msg: err.message,
        timestamp: new Date().getTime(),
      },
    };
  }
  // 配置
  config.onerror = {
    // 针对所有响应类型的错误处理方法，配置all后其他类型处理失效
    json(err, ctx) {
      const { status, body } = convertError(err);
      ctx.status = status;
      ctx.body = body;
    },
    html(err, ctx) {
      const { status, body } = convertError(err);
      ctx.status = status;
      ctx.body = JSON.stringify(body);
    },
  };

  // 文件上传multipart配置
  config.multipart = {
    // file方式上传配置，stream方式则去掉
    mode: 'file',
    // tmpdir: path.join(os.tmpdir(), 'egg-temp', appInfo.name),
    tmpdir: 'egg-temp',
    // 临时文件清除计划
    cleanSchedule: {
      // run tmpdir clean job on every 30 minutes
      // cron style see https://github.com/eggjs/egg-schedule#cron-style-scheduling
      cron: '0 30 * * * *',
    },
    // 文件白名单，否则报异常Error(‘Invalid filename’)
    whitelist: [
      // '.png', '.jpg', '.jpeg', '.gif',
      // 'wma', 'mp3', 'wav', 'amr', 'aud',
      // 'mp4',
      // '.doc', '.docx', '.ppt', '.pptx',
      '.xls', '.xlsx', '.csv',
      // '.pdf',
      // '.txt',
    ],
  };

  return config;
};

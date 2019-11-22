'use strict';
/**
 * 模版生成基础文件
 *  # cd {proj}
 *  # npm run tpl [模块名称/表名称] [模块类型：c-controller, s-service, d-dao, a-apiDoc]
 *
 */
// eslint-disable-next-line import/no-commonjs
const fs = require('fs');

const moduleName = process.argv[2];
const moduleType = process.argv[3];

if (!moduleName) {
  console.log('[模块名称/表名称]不能为空!\n  - 支持单词/下划线命名式/大小驼峰式名称！');
  console.log('示例：\n  npm run tpl test_test \n  npm run tpl h -展示帮助信息；');
  process.exit(0);
}
// console.log(`moduleName[${moduleName}],length[${moduleName.length}]`);
if (moduleName && [ 'help', 'h' ].indexOf(moduleName.toLowerCase()) !== -1) {
  console.log(` 命令格式：
  npm run tpl [模块名称/表名称] [模块类型]；
    - 模块名称/表名称：支持单词/下划线命名式/大小驼峰式名称；
    - 模块类型：c-controller, s-service, d-dao, a-apiDoc；
  npm run tpl test_test c   -生成controller层代码；
  npm run tpl test_test sd  -生成service, dao层代码；
  npm run tpl h             -展示帮助信息；
  `);
  process.exit(0);
}
if (!moduleType) {
  console.log('[模块类型]不能为空！');
  console.log(`  命令格式：
    npm run tpl [模块名称/表名称] [模块类型：c-controller, s-service, d-dao, a-apiDoc]；
    npm run tpl h -展示帮助信息；
  示例：
    npm run tpl test_test c   -生成controller层代码；
    npm run tpl test_test sd  -生成service, dao层代码；
  `);
  process.exit(0);
}

// 获取规范命名
const lowerCase = lowerCamelize(moduleName);
const upperCase = upperCamelize(moduleName);

// dao模版
const daoTep = `
'use strict';

const BaseDao = require('./base.js');

/** doc插件 ctrl+shift+/ 快捷添加注释 */
class ${upperCase}Dao extends BaseDao {
  /**
   * 数据访问处理，基本文档查询参考 'BaseDao.md'。
   *  - （默认不需要）可以通过重写getCollectionName可以指定collection；
   *  - 和数据库collection一一对应；
   *  - 只包含collection的数据操作，不能含有业务逻辑；
   *  - 特殊情况再考虑使用自定义AQL调用this.query实现数据操作；
  */


}

module.exports = ${upperCase}Dao;

`;

// service模版
const serviceTep = `
'use strict';

const BaseService = require('./base.js');

/** doc插件 ctrl+shift+/ 快捷添加注释 */
class ${upperCase}Service extends BaseService {
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
    * @param {object} params 参数对象
    * @return {object} obj
    */
  async demo(params) {
    const { demo } = await this.get(params._id);
    if (demo && Object.keys(demo).length === 0) {
      throw this.BizError(\`[\${params._id}]不存在!\`);
    }
    return { demo };
  }

}

module.exports = ${upperCase}Service;

`;

// controller模版
const controllerTep = `
'use strict';

const BaseController = require('./base.js');
const JoiUtil = require('../utils/JoiUtil');
const Joi = require('@hapi/joi');

/** doc插件 ctrl+shift+/ 快捷添加注释 */
class ${upperCase}Controller extends BaseController {
  /**
   * controller开发规范：参数校验，访问转发。
   *  - 不允许重写getServiceName；
   *  - 只能使用callService调用同名service的服务;
   *  - （默认使用）使用this.success处理响应结果;
   */

  // 新增
  async save() {
    const { ctx, callService } = this;
    const result = await callService(
      'save',
      ctx.request.body,
      JoiUtil.${lowerCase}RequiredSchema
    );
    ctx.body = this.success(result);
  }

  // 查询单个
  async get() {
    const { ctx, callService } = this;
    const result = await callService(
      'get',
      ctx.request.body._id,
      Joi.string().required()
    );
    ctx.body = this.success(result);
  }

  // 按分页查询多个
  async getPage() {
    const { ctx, callService } = this;
    const result = await callService(
      'getPage',
      ctx.request.body,
      Joi.object({
        page_num: Joi.number().integer().required(),
        page_size: Joi.number().integer().required(),
        filter: JoiUtil.${lowerCase}Schema,
      })
    );
    ctx.body = this.success(result);
  }

  // 修改
  async update() {
    const { ctx, callService } = this;
    const result = await callService(
      'update',
      ctx.request.body,
      Joi.object({
        _id: Joi.string().required(),
        newObj: JoiUtil.${lowerCase}Schema,
      })
    );
    ctx.body = this.success(result);
  }

  // 删除
  async delete() {
    const { ctx, callService } = this;
    const result = await callService(
      'delete',
      ctx.request.body._id,
      Joi.string().required()
    );
    ctx.body = this.success(result);
  }

}

module.exports = ${upperCase}Controller;

`;

// api模版
const apiTep = `
API基础文档: [拷贝到Api.yaml相应位置]
  - name: ${lowerCase}
    description: 模块名称

    ${upperCase}:
      description: ${upperCase}对象
      type: object
      properties:
        name:
          type: string
          description: 名称

  /${lowerCase}/save:
    post:
      tags:
        - ${lowerCase}
      summary: 创建${lowerCase}
      description: ""
      operationId: ""
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/${upperCase}"
      responses:
        "200":
          description: successful!
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CommonDmlRes'
  /${lowerCase}/get:
    post:
      tags:
        - ${lowerCase}
      summary: 查询单个${lowerCase}
      description: ""
      operationId: ""
      requestBody:
        $ref: "#/components/requestBodies/IDData"
      responses:
        "200":
          description: successful!
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                    description: "标志: -1-异常;0-成功;"
                    ${lowerCase}:
                    $ref: "#/components/schemas/${upperCase}"
  /${lowerCase}/getPage:
    post:
      tags:
        - ${lowerCase}
      summary: 按分页查询多个${lowerCase}
      description: ""
      operationId: ""
      requestBody:
        $ref: "#/components/requestBodies/PageQueryData"
      responses:
        "200":
          description: successful!
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                    description: "标志: -1-异常;0-成功;"
                  total_count:
                    type: number
                  has_more:
                    type: number
                  end:
                    type: number
                  ${lowerCase}s:
                    type: array
                    items:
                      $ref: "#/components/schemas/${upperCase}"
  /${lowerCase}/update:
    post:
      tags:
        - ${lowerCase}
      summary: 修改${lowerCase}
      description: ""
      operationId: ""
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                _id:
                  type: string
                newObj:
                  $ref: "#/components/schemas/${upperCase}"
      responses:
        "200":
          description: successful!
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CommonDmlRes'
  /${lowerCase}/delete:
    post:
      tags:
        - ${lowerCase}
      summary: 删除单个${lowerCase}
      description: ""
      operationId: ""
      requestBody:
        $ref: "#/components/requestBodies/IDData"
      responses:
        "200":
          description: successful!
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CommonDmlRes'

Joi基础对象: [拷贝到JoiUtil.js，简单对象可以直接在controller层写Joi对象]
// ${lowerCase}必填字段：新增
module.exports.${lowerCase}RequiredSchema = Joi.object({
  name: Joi.string().required(),
}).required();
// ${lowerCase}选填字段：修改
module.exports.${lowerCase}Schema = Joi.object({
  name: Joi.string(),
}).required();

`;

let tmpDesc = '';
const rootDir = process.cwd();
const fullFileName = `${lowerCase}.js`;
if (moduleType.indexOf('c') !== -1) {
  // 创建controller
  process.chdir('./app/controller'); // cd $1
  if (fs.existsSync(fullFileName)) {
    console.log('已经存在文件：./app/controller/' + fullFileName);
  } else {
    tmpDesc += `./app/controller/${fullFileName}\n`;
    fs.writeFileSync(fullFileName, controllerTep);
  }
  process.chdir(rootDir); // 切回目录
}
if (moduleType.indexOf('s') !== -1) {
  // 创建service
  process.chdir('./app/service'); // cd $1
  if (fs.existsSync(fullFileName)) {
    console.log('已经存在文件：./app/service/' + fullFileName);
  } else {
    tmpDesc += `./app/service/${fullFileName}\n`;
    fs.writeFileSync(fullFileName, serviceTep);
  }
  process.chdir(rootDir); // 切回目录
}
if (moduleType.indexOf('d') !== -1) {
  // 创建dao
  process.chdir('./app/dao'); // cd $1
  if (fs.existsSync(fullFileName)) {
    console.log('已经存在文件：./app/dao/' + fullFileName);
  } else {
    tmpDesc += `./app/dao/${fullFileName}\n`;
    fs.writeFileSync(`${fullFileName}`, daoTep);
  }
  process.chdir(rootDir); // 切回目录
}

let retDesc = '模版${moduleName} 创建文件列表如下：';
if (!tmpDesc || tmpDesc.trim() === '') {
  retDesc = '没有创建任何文件，请确认脚本是否正确：\nnpm run tpl h -展示帮助信息；';
}
console.log(retDesc);
console.log(tmpDesc);

// 文档生成
if (moduleType.indexOf('a') !== -1) {
  console.log(apiTep);
}

// // 转换首字母
// function firstUpper(str) {
//   const firstUpper = str.charCodeAt(0) - 32;
//   return String.fromCharCode.apply(String, [ firstUpper ]) + str.substring(1);
// }

// 小驼峰式
function lowerCamelize(str) {
  // test-test/test_test => testTest
  const res = str.replace(/[_-][a-z]/ig, s => s[1].toUpperCase());
  // 保证首字母为小写
  return res[0].toLowerCase() + res.substring(1);
}
// 大驼峰式（即帕斯卡命名法）
function upperCamelize(str) {
  // 小驼峰式
  const res = lowerCamelize(str);
  // 保证首字母为大写
  return res[0].toUpperCase() + res.substring(1);
}

process.exit(0);

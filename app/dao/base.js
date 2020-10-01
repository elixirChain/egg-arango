'use strict';

const Joi = require('@hapi/joi');
// const pluralize = require('pluralize');
const moment = require('moment');

/**
 * Dao层基类：
 * - 提供默认的Collection名获取方法this.getCollectionName，允许被重写指定Collection；
 * - 提供默认的WITH Collection参数获取方法this.getWithCollectionNames，允许被重写指定Collections；
 * - 提供统一AQL工具方法：
 *  - validateData 统一校验函数
 *  - convertArrayToObject 查询结果转换
 *  - getFilterAql 拼装过滤参数
 *  - getLikeAql 拼装like条件
 *  - getSortAql 拼装排序条件
 *  - getSortFieldAqlList 处理排序字符串（不含SORT）
 *  - getResAql 拼装响应结构
 *  - query 统一查询方法
 *  - 其他数据访问处理：见基础工程BaseDao.md
 *
 * @refer:
 * https://www.arangodb.com/docs/3.4/aql/data-queries.html
 * https://www.arangodb.com/docs/3.4/aql/graphs-traversals.html
 * https://www.arangodb.com/docs/3.4/drivers/js-reference-database-queries.html#aql
 * - WITH: optional for single server instances, but required for graph traversals in a cluster.
 */
class BaseDao {
  constructor(_ctx) {
    this.ctx = _ctx;
    this.aql = this.ctx.app.aql;
    this.arango = this.ctx.app.arango;
    this.logger = this.ctx.logger;
    // 处理业务异常
    this.errorCode = this.ctx.helper.errorCode;
    this.BizError = (error, code) => {
      if (process.env.NODE_ENV === 'development') {
        error = `${this.constructor.name} error:` + error;
      }
      throw new this.ctx.helper.BizError(error, code);
    };
    // 参考PageUtil：转换分页参数：page_num,page_size => offset,count
    this.convertOffset = (page_num, page_size) => {
      if (page_num && page_size && page_num > 0) {
        return (page_num - 1) * page_size;
      }
      return 0;
    };
    // 过滤属性，在非赋值情况不覆盖数据：update，insert
    this.unset = [ '_id', '_rev', '_key', '_status', '_create_date' ];
    // 过滤属性：查询剔除非必要字段
    this.unsetRes = [ '_rev', '_key', '_status', 'password' ];
    // 排序对象验证
    this.sortSchema = Joi.array().min(1).items(
      Joi.object({
        field: Joi.string().required(),
        direction: Joi.string().valid('', 'asc', 'desc', 'ASC', 'DESC'),
      }).required());
    // 最少一个不为非法不可空（保存/查询单个）：限制至少一个属性，不为空（'', null），不允许非法字符
    this.filterMinRequired = Joi.object().min(1).pattern(/.*/, Joi.any().invalid('', null, NaN, Infinity).required());
    // 最少一个不为非法可空（修改）：限制至少一个属性，允许空（'', null），不允许非法字符
    this.filterMinValid = Joi.object().min(1).pattern(/.*/, Joi.any().invalid(NaN, Infinity).required());
    // 通用查询条件验证（一般查询）：不限制空，允许空（'', null），不允许非法字符
    this.filterCommon = Joi.object().pattern(/.*/, Joi.any().invalid(NaN, Infinity).required());
    // 边表查询Options
    this.optionsSchema = Joi.object({
      // Edge RES: default return v, when true return {v, e}.
      hasEdge: Joi.boolean(),
      // Edge RES: default return v, when true return merge(v, {_from, _to}).
      hasFromTo: Joi.boolean(),
      // limit RES attrs.
      keepAttrs: Joi.string(),
      // Graph depth: default 1..N, when true use N.
      depthLimit: Joi.boolean(),
      // convert data flag for suffix _scode
      convertStaticFlag: Joi.boolean(),
      // convert data flag for suffix _acode
      convertAreaFlag: Joi.boolean(),
    });
    // 模糊匹配条件验证
    this.likeSchema = Joi.object({
      or: Joi.array().min(1).items(
        Joi.object({
          field: Joi.string().required(),
          search: Joi.string().required(),
          caseFlag: Joi.boolean(),
        }).required()),
      and: Joi.array().min(1).items(
        Joi.object({
          field: Joi.string().required(),
          search: Joi.string().required(),
          caseFlag: Joi.boolean(),
        }).required()),
    }).min(1);
  }

  /**
   * get collection name:
   *   1.dao class name default: [collection name with first char uppercase]+Dao;
   *   2.subclass can overwrite 'getCollectionName' for a different collection name.
   * @abstract
   * @return {string} collection name
   */
  getCollectionName() {
    let name = this.constructor.name;
    // substring length of 'dao'
    name = name.substring(0, name.length - 3);
    // testTest/TestTest => test_test
    return this.ctx.helper.underlineCase(name);
  }

  /**
   * 获取响应结构
   * - 默认是'_to_'连接的两个collection name，或者去掉_graph的collection name;
   * - 子类重写此函数指定with参数;
   * @return {string} withNames
   */
  getWithCollectionNames() {
    // 默认值
    const collectionName = this.getCollectionName();
    return collectionName.replace('_graph', '').split('_to_').join(',');
  }

  // 获取小驼峰名称
  getLowerCollectionName() {
    return this.ctx.helper.lowerCamelize(this.getCollectionName());
  }

  /**
   * 统一校验函数
   * @param {object} joi_schema joi对象
   * @param {any} params 校验对象
   * @return {boolean} flag
   */
  validateData(joi_schema, params) {
    if (joi_schema) {
      const { error } = joi_schema.validate(params);
      if (!!error) {
        this.logger.error(`${this.constructor.name} params: `, params);
        throw this.BizError(error.message);
      } else {
        return true;
      }
    } else {
      return false;
    }
  }

  // 查询结果转换：AQL返回都是数组对象，统一对二次封装的对象处理或者获取单个数据转换
  convertArrayToObject(arr) {
    // 返回undefined 解析json时,属性会被删除
    return !arr || arr.length === 0 ? null : arr[0];
  }

  /**
   * 拼装过滤参数：使用FILTER可以利用索引（and连接）
   * - （单数类型）默认==匹配
   * - array类型使用in匹配
   * - object{opr, value}类型使用指定操作符
   *  - opr = 'POSITION' 时需要处理数组属性的查询参数
   * aql.join, aql.literal @see https://www.arangodb.com/docs/devel/appendix-java-script-modules-arango-db.html
   * @param {object} filter 查询参数对象
   * @param {string} alias alias of collection
   * @return {AQL} obj
   */
  getFilterAql(filter, alias) {
    // 默认别名为't'
    if (!alias) {
      alias = 't';
    }
    alias = this.aql.literal(alias);

    let filterAql;
    if (filter) {
      let filterAqlList = [];
      const otherFilterAqlList = [];
      const arrayAttrAqlList = [];
      for (const key in filter) {
        const data = filter[key];
        if (Array.isArray(data)) {
          // 数组参数，则‘in’
          filterAqlList.push(this.aql` and ${alias}.${key} in ${data}`);
        } else if (!!data && typeof data === 'object') {
          /**
           * 对象参数结构{opr, value}
           * 支持：==, !=, <, <=, >, >=, IN, NOT IN, LIKE, =~, !~
           * 注意: typeof null === 'object'
           * 增加：opr = 'POSITION' 时需要处理数组属性的查询参数
           */
          if (data.opr === 'POSITION') {
            arrayAttrAqlList.push(this.getArrayAttrAql(alias, key, data.value));
          } else {
            otherFilterAqlList.push(this.aql` and ${alias}.${key} ${this.aql.literal(data.opr)} ${data.value}`);
          }
        } else {
          // 单个参数，默认‘==’
          filterAqlList.push(this.aql` and ${alias}.${key} == ${data}`);
        }
      }
      // otherFilterAqlList在后，符合最左匹配原则
      filterAqlList = filterAqlList.concat(otherFilterAqlList).concat(arrayAttrAqlList);
      if (filterAqlList.length !== 0) {
        filterAql = this.aql.join(filterAqlList);
      }
    }
    return filterAql;
  }

  /**
   * data: value(string/array)
   * 处理数组属性的查询参数
   */
  getArrayAttrAql(alias, key, data) {
    const arrayAttrAqlList = [];
    // 数组拆分元素用 or 连接
    if (Array.isArray(data)) {
      // 处理 or 条件
      data && data.forEach((el, idx) => {
        if (idx === 0) {
          arrayAttrAqlList.push(this.aql`\nFILTER `);
        }

        // filter 隐含了 ‘and’条件，所以只需要所有的 ‘or’ 条件连接在一个 filter 即可
        if (idx === data.length - 1) {
          arrayAttrAqlList.push(this.aql`${el} in ${alias}.${key} `);
        } else {
          arrayAttrAqlList.push(this.aql`${el} in ${alias}.${key} or `);
        }
      });
    } else {
      arrayAttrAqlList.push(this.aql`\nFILTER ${data} in ${alias}.${key}`);
    }
    return this.aql.join(arrayAttrAqlList)
  }

  /**
   * 拼装like条件
   * - or（or连接，使用同一个FILTER）
   * - and（and连接, 等同于多行FILTER拼接）
   * @param {object} like like参数对象
   * @param {string} alias alias of collection
   * @return {AQL} obj
   */
  getLikeAql(like, alias) {
    // 默认别名为't'
    if (!alias) {
      alias = 't';
    }
    alias = this.aql.literal(alias);

    // 初始化
    const orAqlList = [];
    const andAqlList = [];
    let orAql;
    let andAql;
    // 分别处理 or 和 and 对象
    if (like) {
      // 处理 or 条件
      like.or && like.or.forEach((el, idx) => {
        // filter 隐含了 ‘and’条件，所以只需要所有的 ‘or’ 条件连接在一个 filter 即可
        if (idx === 0) {
          orAqlList.push(this.aql`\nFILTER `);
        }
        // 大小写敏感
        let caseInsensitive;
        if (el.caseFlag) {
          caseInsensitive = this.aql.literal(', true');
        }
        if (idx === like.or.length - 1) {
          orAqlList.push(this.aql`LIKE(${alias}.${el.field}, ${el.search}${caseInsensitive}) `);
        } else {
          orAqlList.push(this.aql`LIKE(${alias}.${el.field}, ${el.search}${caseInsensitive}) or `);
        }
      });

      // 处理 and 条件
      like.and && like.and.forEach(el => {
        // 大小写敏感
        let caseInsensitive;
        if (el.caseFlag) {
          caseInsensitive = this.aql.literal(', true');
        }
        andAqlList.push(this.aql`\nFILTER LIKE(${alias}.${el.field}, ${el.search}${caseInsensitive})`);
      });
      // 拼装AQL
      if (orAqlList.length !== 0) {
        orAql = this.aql.join(orAqlList);
      }
      if (andAqlList.length !== 0) {
        andAql = this.aql.join(andAqlList);
      }
    }
    return { orAql, andAql };
  }

  /**
   * 拼装排序条件
   * @param {array} sortFieldAqlList params
   * @return {AQL} obj
   */
  getSortAql(sortFieldAqlList) {
    if (sortFieldAqlList && sortFieldAqlList.length > 0) {
      // 添加到开头
      const sorts = [ this.aql` SORT` ];
      sorts.push(sortFieldAqlList[0]);
      // 补逗号
      for (let i = 1; i < sortFieldAqlList.length; i++) {
        sorts.push(this.aql`, `);
        sorts.push(sortFieldAqlList[i]);
      }

      sortFieldAqlList = sorts;
    }
    // 拼接完整sort AQL
    return this.aql.join(sortFieldAqlList);
  }

  /**
   * 处理排序字符串（不含SORT）
   * @param {object} sorts params
   * @param {string} alias alias of collection
   * @return {AQL} obj
   */
  getSortFieldAqlList(sorts, alias) {
    // 默认别名为't'
    if (!alias) {
      alias = 't';
    }
    alias = this.aql.literal(alias);

    // 默认时间倒序和_id倒序
    // const fieldAqlList = [ this.aql` ${alias}._create_date desc, ${alias}._id desc ` ];
    const fieldAqlList = [ this.aql` ${alias}._id ` ];
    if (sorts) {
      // 删除默认排序
      fieldAqlList.shift();
      sorts && sorts.forEach((el, idx) => {
        fieldAqlList.push(this.aql`${alias}.${el.field} ${!el.direction ? '' : el.direction}`);
      });
    }
    return fieldAqlList;
  }

  /**
   * 拼装响应结构
   * - 边表响应 options.hasEdge: true时，响应'{vertex: v, edge: e}'; 默认是'v';
   * - 指定响应 options.keepAttrs: 指定查询响应属性name，属性name拼接，逗号分隔;
   * @param {object} options 查询配置项
   * @param {string} alias alias of collection
   * @return {AqlQuery} aql
   */
  getResAql(options, alias) {
    // 默认别名为't'，边表则传‘v’
    let edgeFlag = true;
    if (!alias || alias === 't') {
      alias = 't';
      edgeFlag = false;
    }
    alias = this.aql.literal(alias);
    // 响应结果处理函数: 默认'UNSET'
    let func = this.aql.literal('UNSET');

    // 处理配置项
    let keepAttrs = this.unsetRes;
    if (!!options) {
      // 响应结构默认排除属性，即处理func
      if (options.keepAttrs && options.keepAttrs.trim() !== '') {
        // 保留属性函数
        func = this.aql.literal('KEEP');
        // 剔除传入保留属性中含有的默认排除属性
        keepAttrs = options.keepAttrs.split(',').filter(v => !this.unsetRes.includes(v));
      }

      // 处理边表特殊响应
      if (edgeFlag) {
        // 响应顶点和边数据
        if (options.hasEdge) {
          return this.aql`{ vertex: ${func}(${alias}, ${keepAttrs}), edge: ${func}(e, ${keepAttrs}) }`;
        }
        // 合并_from和_to数据用于关系处理
        if (options.hasFromTo) {
          return this.aql`MERGE(${func}(${alias}, ${keepAttrs}), {_from: e._from, _to: e._to})`;
        }
      }
    }

    // 通用响应
    return this.aql`${func}(${alias}, ${keepAttrs})`;
  }

  /**
   * 静态数据转义
   * - 使用type为字段名；
   * - 使用[type]_name为转义名称；
   * - 没有匹配则无转义，字段为undefined；
   * @param {object} options 配置项：转义标志
   * @param {string} resList 需要转义的结果，默认‘list’
   * @return {AqlQuery} aql
   */
  getStaticDataAql(options, resList) {
    if (!options || !(options.convertStaticFlag || options.convertAreaFlag)) {
      return this.aql`for t in list return t`;
    }
    if (!resList) {
      resList = 'list';
    }

    // 静态数据模板字符串
    let staticAql = this.aql`let staticRet = {}`;
    if (options.convertStaticFlag) {
      staticAql = this.aql`
      // 获取静态数据属性
      let types = (
        for k in ATTRIBUTES(rt)
          FILTER LIKE(k, '%_scode')
        return k
      )
      // 拼装静态数据对象：转义属性和值
      let staticRet = MERGE(
        for t in static_data
          filter t.type in types and t.code == rt[t.type]
        return {[CONCAT(t.type, '_name')]: t.name}
      )`;
    }

    // 地区数据模板字符串
    let areaAql = this.aql`let areaRet = {}`;
    if (options.convertAreaFlag) {
      areaAql = this.aql`
      // 获取地区数据属性
      let areaTypes = (
        for k in ATTRIBUTES(rt)
          FILTER LIKE(k, '%_acode')
        return k
      )
      // 拼装地区(籍贯)：转义属性和值
      let areaRet = MERGE(
        for at in areaTypes
          // 拼装省市区code数组
          let area_codes = (
            for code in [CONCAT(LEFT(rt[at], 2), '0000'), CONCAT(LEFT(rt[at], 4), '00'), rt[at]]
            sort code
            return distinct code
          )
          // 转义省市区名称
          let area_code_name = concat(
            for t in area_data
              filter t.code in area_codes
              sort t.code
              return t.name
          )
          // 组合省市区code和名称
          return {[at]: area_codes, [CONCAT(at, '_name')]: area_code_name}
      )`;
    }

    // 拼装转换AQL
    return this.aql`
    // 循环处理结果列表
    for rt in ${this.aql.literal(resList)}
      ${staticAql}
      ${areaAql}
      // 合并结果
      return MERGE(rt, staticRet, areaRet)
    `;
  }

  // 打印Aql
  logQueryAql(query) {
    let aqlStr = query.query;
    for (const key in query.bindVars) {
      aqlStr = aqlStr.toString().replace(new RegExp(`@${key}`, 'gim'), JSON.stringify(query.bindVars[key]));
    }
    this.logger.debug('\nAQL:\n' + aqlStr);
  }

  /**
   * 统一查询方法
   * @param {AqlQuery} _query 查询对象
   * @param {object} _opt 选项
   * @return {object} obj
   */
  async query(_query, _opt) {
    try {
      this.logQueryAql(_query);
      return (await this.arango.query(_query, _opt)).all();
    } catch (error) {
      throw this.BizError('Execute AQL ERROR: ' + error.message);
    }
  }

  /**
   * Document API
   */

  // 兼容旧api
  async get(_id, options) {
    return await this.getOne({ _id, options });
  }

  /**
   * get document by _id of collection
   * @param {object} _params - params object
   * @param {string} _params._id - the _id of the document
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async getOne(_params) {
    this.validateData(
      Joi.object({
        _id: Joi.string().required(),
        options: this.optionsSchema,
      }).required(),
      _params
    );

    // 获取响应结构
    const resAQL = this.getResAql(_params.options);
    // 转义静态数据
    const staticDataAQL = this.getStaticDataAql(_params.options);

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      LET list = (
        FOR t IN ${collection} 
          FILTER t._id == ${_params._id} && t._status == true 
        RETURN ${resAQL}
      )
      ${staticDataAQL}`;
    const objs = await this.query(query);
    // 验证唯一性
    this.validateData(Joi.array().max(1), objs);
    return this.convertArrayToObject(objs);
    // return { [this.getLowerCollectionName()]: this.convertArrayToObject(objs) };
  }

  // 兼容旧api
  async getByFilter(filter, options) {
    return await this.getOneByFilter({ filter, options });
  }

  /**
   * get document by filter from collection
   * @param {object} _params - params object
   * @param {object} _params.filter - filter of attrs.
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async getOneByFilter(_params) {
    this.validateData(
      Joi.object({
        filter: this.filterMinRequired.required(),
        options: this.optionsSchema,
      }),
      _params
    );

    // 修改为使用FILTER可以利用索引
    const filterAql = this.getFilterAql(_params.filter);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options);
    // 转义静态数据
    const staticDataAQL = this.getStaticDataAql(_params.options);

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      LET list = (
        FOR t IN ${collection} 
          FILTER t._status == true ${filterAql}
          SORT t._create_date desc 
        RETURN ${resAQL}
      )
      ${staticDataAQL}`;
    const objs = await this.query(query);
    // TODO:验证唯一性
    // this.validateData(Joi.array().max(1), objs);
    return this.convertArrayToObject(objs);
    // return { [this.getLowerCollectionName()]: this.convertArrayToObject(objs) };
  }

  // 使用getsByFilter
  async gets(_params) {
    return await this.getsByFilter({
      filter: {
        _id: _params._ids,
      },
      sorts: _params.sorts,
      options: _params.options,
    });
  }

  /**
   * get documents by filter of collection
   * @param {object} _params - params object
   * @param {object} _params.filter - filter of attrs.
   * @param {object} _params.like - the object to like the documents to get from the collection
   * @param {array} _params.sorts - array of sort str for attrs.
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async getsByFilter(_params) {
    this.validateData(
      Joi.object({
        filter: this.filterMinRequired,
        like: this.likeSchema,
        sorts: this.sortSchema,
        options: this.optionsSchema,
      }).oxor('filter', 'like').required(),
      _params
    );

    // 修改为使用FILTER可以利用索引
    const filterAql = this.getFilterAql(_params.filter);
    // 拼装like条件
    const { orAql, andAql } = this.getLikeAql(_params.like);
    // 拼装排序条件 默认创建时间倒序
    const sortAql = this.getSortAql(this.getSortFieldAqlList(_params.sorts));
    // 获取响应结构
    const resAQL = this.getResAql(_params.options);
    // 转义静态数据
    const staticDataAQL = this.getStaticDataAql(_params.options);

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    // const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
    LET tsl = (
      LET list = (
        FOR t IN ${collection} 
          FILTER t._status == true ${filterAql}
          ${andAql} 
          ${orAql}
          ${sortAql}
        RETURN ${resAQL}
      )
      ${staticDataAQL}
    )
    RETURN tsl`;
    // RETURN {${collections}: tsl}`;
    return this.convertArrayToObject(await this.query(query));
  }

  /**
   * get documents by limit from collection
   * default sort by _create_date DESC, it should before LIMIT(query for the same results).
   * @param {object} _params - params object
   * @param {number} _params.page_num - 页码，从1开始；
   * @param {number} _params.page_size - 页数据条数，从1开始；
   * @param {object} _params.filter - the object to filter the documents to get from the collection
   * @param {object} _params.like - the object to like the documents to get from the collection
   * @param {array} _params.sorts - sort array, rely on the sort of this array.
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async getPage(_params) {
    this.validateData(
      Joi.object({
        page_num: Joi.number().integer().required(),
        page_size: Joi.number().integer().required(),
        filter: this.filterCommon,
        like: this.likeSchema,
        sorts: this.sortSchema,
        options: this.optionsSchema,
      }).required(),
      _params
    );

    // 转换分页参数：pageNum,page_size => offset,count
    _params.offset = this.convertOffset(_params.page_num, _params.page_size);
    _params.count = _params.page_size;

    // 修改为使用FILTER可以利用索引
    const filterAql = this.getFilterAql(_params.filter);
    // 拼装like条件
    const { orAql, andAql } = this.getLikeAql(_params.like);
    // 拼装排序条件 默认创建时间倒序
    const sortAql = this.getSortAql(this.getSortFieldAqlList(_params.sorts));
    // 获取响应结构
    const resAQL = this.getResAql(_params.options);
    // 转义静态数据
    const staticDataAQL = this.getStaticDataAql(_params.options);

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    // const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      LET ts = ( 
        FOR t IN ${collection} 
          FILTER t._status == true ${filterAql}
          ${andAql} 
          ${orAql}
          ${sortAql}
        RETURN ${resAQL} 
      ) 
      LET tsl = (
        LET list = (
          FOR tl IN ts 
            LIMIT ${_params.offset},${_params.count} 
          RETURN tl 
        )
        ${staticDataAQL}
      ) 
      LET totalCount = LENGTH(ts) 
      LET flag = (${_params.offset} + ${_params.count} >= totalCount) 
      LET end = flag ? totalCount : ${_params.offset} + ${_params.count} 
      LET hasMore = !flag 
      RETURN {total_count:totalCount, has_more:hasMore, end:end, list:tsl}`;
      // RETURN {total_count:totalCount, has_more:hasMore, end:end, ${collections}:tsl}`;
    return this.convertArrayToObject(await this.query(query));
  }

  /**
   * save single document
   * @param {object} doc - the new document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async save(doc) {
    this.validateData(this.filterMinRequired.required(), doc);
    const create_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      INSERT MERGE(UNSET(${doc}, ${this.unset}), { _create_date:${create_date}, _status: true }) 
      INTO ${collection} 
      RETURN {_id: NEW._id}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().length(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * save some documents
   * @param {object[]} docs - the array of the new documents
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async saves(docs) {
    this.validateData(Joi.array().min(1).items(this.filterMinRequired.required()), docs);
    const create_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    let tsl = (
      FOR t IN ${docs}
        INSERT MERGE(UNSET(t, ${this.unset}), { _create_date:${create_date}, _status: true }) 
        INTO ${collection} 
      RETURN NEW._id
    )
    RETURN {_ids: tsl}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().min(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * update document by _id && newObj from collection
   * @param {object} _params - the _id of the document
   * @param {string} _params._id - the _id of the document
   * @param {object} _params.newObj - the newObj of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async update(_params) {
    this.validateData(
      Joi.object({
        _id: Joi.string().required(),
        newObj: this.filterMinValid.required(),
        aqlOption: this.filterCommon,
      }).required(),
      _params
    );
    const update_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const aqlOption = this.aql.literal(`OPTIONS ${_params.aqlOption}`);
    const query = this.aql`
    FOR t IN ${collection} 
      FILTER t._id == ${_params._id} and t._status == true 
        UPDATE t WITH MERGE(UNSET(${_params.newObj}, ${this.unset}), { _update_date:${update_date}})
        IN ${collection} ${aqlOption}
        RETURN {_id: NEW._id}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().length(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * update some documents by _ids && newObj from collection
   * @param {object} _params - params object
   * @param {string[]} _params._ids - the _ids of the document
   * @param {object} _params.newObj - the newObj of the documents
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async updates(_params) {
    this.validateData(
      Joi.object({
        _ids: Joi.array().min(1).items(Joi.string().required())
          .required(),
        newObj: this.filterMinValid.required(),
      }).required(),
      _params
    );
    const update_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    let tsl = (
      FOR id IN ${_params._ids}
        FOR t IN ${collection} 
          FILTER t._id == id and t._status == true 
            UPDATE t WITH MERGE(UNSET(${_params.newObj}, ${this.unset}), { _update_date:${update_date}})
            IN ${collection} OPTIONS { keepNull: false }
            RETURN NEW._id
    )
    RETURN {_ids: tsl}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().min(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * update some documents by _ids && newObj from collection
   * @param {array} _params - params object
   * @param {string} _params[]._id - the _ids of the document
   * @param {object} _params[].newObj - the newObj of the documents
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async updatesEach(_params) {
    this.validateData(
      Joi.array().min(1).items(
        Joi.object({
          _id: Joi.string().required(),
          newObj: this.filterMinValid.required(),
          aqlOption: this.filterCommon,
        }))
        .required(),
      _params
    );
    const update_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    let tsl = (
      FOR it IN ${_params}
        FOR t IN ${collection} 
          FILTER t._id == it._id and t._status == true 
            UPDATE t WITH MERGE(UNSET(it.newObj, ${this.unset}) , { _update_date:${update_date}})
            IN ${collection} OPTIONS { keepNull: false }
            RETURN NEW._id
    )
    RETURN {_ids: tsl}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().min(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * not real delete, update document._status to false by _id from collection
   * @param {string} _id - params object
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async delete(_id) {
    this.validateData(Joi.string().required(), _id);
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      LET key = PARSE_IDENTIFIER(${_id}).key 
      UPDATE key WITH { _status: false } 
      IN ${collection}  
      RETURN {_id: NEW._id}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().length(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * not real delete, update document._status to false by _id from collection
   * @param {string} _id - the _id of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async physicalDelete(_id) {
    this.validateData(Joi.string().required(), _id);
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      LET key = PARSE_IDENTIFIER(${_id}).key 
      REMOVE key IN ${collection} 
      RETURN {_id: OLD._id}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().length(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * not real delete, update document._status to false by _ids from collection
   * @param {string[]} _ids - the _ids of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async deletes(_ids) {
    this.validateData(Joi.array().min(1).items(Joi.string().required()), _ids);
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    let tsl = (
      FOR t IN ${_ids}
        LET key = PARSE_IDENTIFIER(t).key 
        UPDATE key WITH { _status: false } 
        IN ${collection}  
        RETURN NEW._id
    )
    RETURN {_ids: tsl}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().min(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * Edge Document API
   */

  /**
   * get edge document by _id from collection
   * @param {string} _id - the _id of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   * @deprecated same with get
   */
  async getEdge(_id) {
    return await this.get(_id);
  }

  /**
   * get edge documents by _ids from collection
   * @param {object} _params - params object
   * @param {object} _params._ids - params object
   * @param {array} _params.sorts - array of sort str for attrs.
   * @return {AqlQuery} - interface AqlQuery by arangodb
   * @deprecated same with gets
   */
  async getEdges(_params) {
    return await this.gets(_params);
  }

  // 向前查询边表: _id(_from)
  async outVertices(_params) {
    return await this.getVertices('OUTBOUND', _params);
  }

  // 向后查边表: _id(_to)
  async inVertices(_params) {
    return await this.getVertices('INBOUND', _params);
  }

  /**
   *  get vertices by page from edge collection
   * default sort by _create_date DESC.
   * @param {String} direction 遍历方向
   * @param {object} _params - params object
   * @param {string} _params._id - the _id(_from/_to) of the document
   * @param {object} _params.v_filter - the object to filter the documents to get from the collection
   * @param {object} _params.e_filter - the object to filter the documents to get from the collection
   * @param {array} _params.v_sorts - sort array, rely on the sort of this array.
   * @param {array} _params.e_sorts - sort array, rely on the sort of this array.
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async getVertices(direction, _params) {
    this.validateData(
      Joi.string().valid('OUTBOUND', 'INBOUND', 'ANY').required(),
      direction
    );
    this.validateData(
      Joi.object({
        _id: Joi.string().required(),
        v_filter: this.filterCommon,
        e_filter: this.filterCommon,
        v_sorts: this.sortSchema,
        e_sorts: this.sortSchema,
        options: this.optionsSchema,
      }).required(),
      _params
    );

    // 拼装过滤条件
    let vFilterAql;
    let eFilterAql;
    if (_params.v_filter && _params.e_filter) {
      vFilterAql = this.getFilterAql(_params.v_filter, 'v');
      eFilterAql = this.getFilterAql(_params.e_filter, 'e');
    } else if (_params.v_filter && !_params.e_filter) {
      vFilterAql = this.getFilterAql(_params.v_filter, 'v');
    } else if (!_params.v_filter && _params.e_filter) {
      eFilterAql = this.getFilterAql(_params.e_filter, 'e');
    }

    // 拼装排序条件 默认创建时间倒序
    const eSortAqlList = this.getSortFieldAqlList(_params.e_sorts, 'e');
    const vSortAqlList = this.getSortFieldAqlList(_params.v_sorts, 'v');
    let allSortAqlList = vSortAqlList.concat(eSortAqlList);
    // 指定边排序，则前置
    if (_params.e_sorts) {
      allSortAqlList = eSortAqlList.concat(vSortAqlList);
    }
    const sortAql = this.getSortAql(allSortAqlList);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options, 'v');
    // 转义静态数据
    const staticDataAQL = this.getStaticDataAql(_params.options);

    const collectionName = this.getCollectionName();
    const collection = this.aql.literal(collectionName);
    const collectionNames = this.aql.literal(this.getWithCollectionNames());
    // const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      WITH ${collectionNames}
      LET tsl = (
        LET list = (
          FOR v,e IN ${this.aql.literal(direction)} ${_params._id} ${collection} 
            FILTER v._status == true && e._status == true ${vFilterAql} ${eFilterAql}
            ${sortAql}
          RETURN ${resAQL}
        )
        ${staticDataAQL}
      )
      RETURN tsl`;
      // RETURN {${collections}: tsl}`;
    return this.convertArrayToObject(await this.query(query));
  }

  // 向前分页查询边表: _id(_from)
  async outVerticesPage(_params) {
    return await this.getVerticesPage('OUTBOUND', _params);
  }

  // 向后分页查边表: _id(_to)
  async inVerticesPage(_params) {
    return await this.getVerticesPage('INBOUND', _params);
  }

  /**
   * get vertices by page from edge collection
   * default sort by _create_date DESC, it should before LIMIT(query for the same results).
   * @param {String} direction 遍历方向
   * @param {object} _params - params object
   * @param {string} _params._id - the _id(_from/_to) of the document
   * @param {number} _params.page_num - 页码，从1开始；
   * @param {number} _params.page_size - 页数据条数，从1开始；
   * @param {object} _params.v_filter - the object to filter the documents to get from the collection
   * @param {object} _params.e_filter - the object to filter the documents to get from the collection
   * @param {object} _params.v_like - the object to like the documents to get from the collection
   * @param {object} _params.e_like - the object to like the documents to get from the collection
   * @param {array} _params.v_sorts - sort array, rely on the sort of this array.
   * @param {array} _params.e_sorts - sort array, rely on the sort of this array.
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async getVerticesPage(direction, _params) {
    this.validateData(
      Joi.string().valid('OUTBOUND', 'INBOUND', 'ANY').required(),
      direction
    );
    this.validateData(
      Joi.object({
        _id: Joi.string().required(),
        page_num: Joi.number().integer().required(),
        page_size: Joi.number().integer().required(),
        v_filter: this.filterCommon,
        e_filter: this.filterCommon,
        v_like: this.likeSchema,
        e_like: this.likeSchema,
        v_sorts: this.sortSchema,
        e_sorts: this.sortSchema,
        options: this.optionsSchema,
      }).required(),
      _params
    );

    // 转换分页参数：pageNum,page_size => offset,count
    _params.offset = this.convertOffset(_params.page_num, _params.page_size);
    _params.count = _params.page_size;

    // 拼装过滤条件
    let vFilterAql;
    let eFilterAql;
    if (_params.v_filter && _params.e_filter) {
      vFilterAql = this.getFilterAql(_params.v_filter, 'v');
      eFilterAql = this.getFilterAql(_params.e_filter, 'e');
    } else if (_params.v_filter && !_params.e_filter) {
      vFilterAql = this.getFilterAql(_params.v_filter, 'v');
    } else if (!_params.v_filter && _params.e_filter) {
      eFilterAql = this.getFilterAql(_params.e_filter, 'e');
    }
    // 拼装like条件{ orAql, andAql }
    const vLikeAql = this.getLikeAql(_params.v_like, 'v');
    const eLikeAql = this.getLikeAql(_params.e_like, 'e');

    // 拼装排序条件 默认创建时间倒序
    const eSortAqlList = this.getSortFieldAqlList(_params.e_sorts, 'e');
    const vSortAqlList = this.getSortFieldAqlList(_params.v_sorts, 'v');
    let allSortAqlList = vSortAqlList.concat(eSortAqlList);
    // 指定边排序，则前置
    if (_params.e_sorts) {
      allSortAqlList = eSortAqlList.concat(vSortAqlList);
    }
    const sortAql = this.getSortAql(allSortAqlList);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options, 'v');
    // 转义静态数据
    const staticDataAQL = this.getStaticDataAql(_params.options);

    const collectionName = this.getCollectionName();
    const collection = this.aql.literal(collectionName);
    const collectionNames = this.aql.literal(this.getWithCollectionNames());
    // const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      WITH ${collectionNames}
      LET vs = ( 
        FOR v,e IN ${this.aql.literal(direction)} ${_params._id} ${collection} 
          FILTER v._status == true && e._status == true ${vFilterAql} ${eFilterAql}
          ${vLikeAql.andAql}
          ${eLikeAql.andAql}
          ${vLikeAql.orAql}
          ${eLikeAql.orAql}
          ${sortAql}
          RETURN ${resAQL} 
      ) 
      LET vsl = (
        LET list = (
          FOR vl IN vs 
            LIMIT ${_params.offset},${_params.count} 
          RETURN vl 
        )
        ${staticDataAQL}
      ) 
      LET totalCount = LENGTH(vs) 
      LET flag = (${_params.offset} + ${_params.count} >= totalCount) 
      LET end = flag ? totalCount : ${_params.offset} + ${_params.count} 
      LET hasMore = !flag 
      RETURN {total_count:totalCount, has_more:hasMore, end:end, list:vsl}`;
      // RETURN {total_count:totalCount, has_more:hasMore, end:end, ${collections}:vsl}`;
    return this.convertArrayToObject(await this.query(query));
  }

  /**
   * save single edge document
   * @param {object} _params - params object
   * @param {string} _params._from - the _id(_from) of the document
   * @param {string} _params._to - the _id(_to) of the document
   * @param {string} _params.attrs - the attrs of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async saveEdge(_params) {
    this.validateData(
      Joi.object({
        _from: Joi.string().required(),
        _to: Joi.string().required(),
        attrs: this.filterMinRequired,
      }).required(),
      _params
    );

    // 处理额外属性attrs
    if (_params.attrs) {
      _params = { _from: _params._from, _to: _params._to, ..._params.attrs };
    }

    const create_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    INSERT MERGE(${_params}, { _create_date:${create_date}, _status: true }) 
    INTO ${collection} 
      RETURN {_id: NEW._id}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().length(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * save some edge documents
   * @param {array} _params - params object
   * @param {string} _params[]._from - the _id(_from) of the document
   * @param {string} _params[]._to - the _id(_to) of the document
   * @param {string} _params[].attrs - the attrs of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async saveEdges(_params) {
    this.validateData(
      Joi.array().min(1).items(Joi.object().keys({
        _from: Joi.string().required(),
        _to: Joi.string().required(),
        attrs: this.filterMinRequired,
      }).required())
        .required(),
      _params
    );

    // 处理额外属性attrs
    if (_params) {
      _params.forEach((el, idx) => {
        if (el.attrs) {
          _params[idx] = { _from: el._from, _to: el._to, ...el.attrs };
        }
      });
    }

    const create_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    let tsl = (
      FOR t IN ${_params}
        INSERT MERGE(t, { _create_date:${create_date}, _status: true }) 
        INTO ${collection} 
        RETURN NEW._id
      )
      RETURN {_ids: tsl}`;
    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().min(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * update document by _id && newObj from collection
   * @param {object} _params - params object
   * @param {string} _params._id - the _id of the document
   * @param {object} _params.newObj - the newObj of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async updateEdge(_params) {
    this.validateData(
      Joi.object({
        _id: Joi.string().required(),
        newObj: Joi.object().keys({
          _from: Joi.string(),
          _to: Joi.string(),
        }).required(),
      }).required(),
      _params
    );
    return await this.update(_params);
  }

  /**
   * update some documents by _ids && newObj from collection
   * @param {object} _params - params object
   * @param {string[]} _params._ids - the _ids of the document
   * @param {object} _params.newObj - the newObj of the documents
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async updateEdges(_params) {
    this.validateData(
      Joi.object({
        _ids: Joi.array().min(1).items(Joi.string().required())
          .required()
          .required(),
        newObj: Joi.object().keys({
          _from: Joi.string(),
          _to: Joi.string(),
        }).required(),
      }).required(),
      _params
    );
    return await this.updates(_params);
  }

  /**
   * update some documents by _ids && newObj from collection
   * @param {array} _params - params object
   * @param {string} _params[]._id - the _ids of the document
   * @param {object} _params[].newObj - the newObj of the documents
   * @param {object} _params[].newObj._from - the newObj._from of the documents
   * @param {object} _params[].newObj._id - the newObj._id of the documents
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async updateEdgesEach(_params) {
    this.validateData(
      Joi.array().min(1).items(
        Joi.object({
          _id: Joi.string().required(),
          newObj: Joi.object().keys({
            _from: Joi.string(),
            _to: Joi.string(),
          }).required(),
        }))
        .required(),
      _params
    );
    return await this.updates(_params);
  }

  /**
   * not real delete, update document._status to false by _id from collection
   * @param {string} _id - the _id of the edge document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   * @deprecated same with delete
   */
  async deleteEdge(_id) {
    return await this.delete(_id);
  }

  /**
   * not real delete, update document._status to false by _ids from collection
   * @param {string[]} _ids - the _ids of the documents
   * @return {AqlQuery} - interface AqlQuery by arangodb
   * @deprecated same with deletes
   */
  async deleteEdges(_ids) {
    return await this.deletes(_ids);
  }

  /**
   * not real delete, update document._status to false by _id from collection
   * @param {object} _params - params object
   * @param {string} _params._from - the _id(_from) of the document
   * @param {string} _params._to - the _id(_to) of the document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   * @deprecated same with delete
   */
  async deleteEdgesByVertex(_params) {
    // 通过_from或者_to删除边表数据（_from, _to至少存在一个，且不能为undefined）
    this.validateData(
      Joi.object().or('_from', '_to').pattern(/.*/, [ Joi.string().required(), Joi.array().min(1).required() ]),
      _params
    );

    // 修改为使用FILTER可以利用索引
    const filterAql = this.getFilterAql(_params);

    const update_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      let tsl = (
        FOR t IN ${collection} 
        FILTER t._status == true ${filterAql}
          UPDATE t WITH { _status: false, _update_date:${update_date} }
          IN ${collection}
          RETURN NEW._id
      )
      RETURN {_ids: tsl}`;

    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().min(1), objs);
    return this.convertArrayToObject(objs);
  }

  /**
   * Graph Document API
   */

  // 向前查询图
  async outGraphVertices(_params) {
    return await this.getGraphVertices('OUTBOUND', _params);
  }

  // 向后查询图
  async inGraphVertices(_params) {
    return await this.getGraphVertices('INBOUND', _params);
  }

  /**
   * 查询图
   * @param {String} direction 遍历方向
   * @param {object} _params 参数对象
   * @param {string} _params.start_id - the start_id of the graph
   * @param {integer} _params.depth - the depth of the graph (with options.depthLimit)
   * @param {object} _params.v_filter - the object to filter the documents to get from the collection
   * @param {object} _params.e_filter - the object to filter the documents to get from the collection
   * @param {array} _params.v_sorts - sort array, rely on the sort of this array.
   * @param {array} _params.e_sorts - sort array, rely on the sort of this array.
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {object} obj
   */
  async getGraphVertices(direction, _params) {
    this.validateData(
      Joi.string().valid('OUTBOUND', 'INBOUND', 'ANY').required(),
      direction
    );
    this.validateData(
      Joi.object({
        start_id: Joi.string().required(),
        depth: Joi.number().integer().required(),
        v_filter: this.filterCommon,
        e_filter: this.filterCommon,
        v_sorts: this.sortSchema,
        e_sorts: this.sortSchema,
        options: this.optionsSchema,
      }).required(),
      _params
    );

    // 路径长度: 默认为0
    let depth = '0';
    if (_params.depth && _params.depth > 0) {
      if (_params.options && _params.options.depthLimit || _params.depth === 1) {
        depth = _params.depth.toString();
      } else {
        depth = `1..${_params.depth}`;
      }
    }
    const depthAql = this.aql.literal(depth);
    const startIdSql = this.aql.literal(_params.start_id);

    // 拼装过滤条件
    let vFilterAql;
    let eFilterAql;
    if (_params.v_filter && _params.e_filter) {
      vFilterAql = this.getFilterAql(_params.v_filter, 'v');
      eFilterAql = this.getFilterAql(_params.e_filter, 'e');
    } else if (_params.v_filter && !_params.e_filter) {
      vFilterAql = this.getFilterAql(_params.v_filter, 'v');
    } else if (!_params.v_filter && _params.e_filter) {
      eFilterAql = this.getFilterAql(_params.e_filter, 'e');
    }

    // 拼装排序条件 默认创建时间倒序
    const eSortAqlList = this.getSortFieldAqlList(_params.e_sorts, 'e');
    const vSortAqlList = this.getSortFieldAqlList(_params.v_sorts, 'v');
    let allSortAqlList = vSortAqlList.concat(eSortAqlList);
    // 指定边排序，则前置
    if (_params.e_sorts) {
      allSortAqlList = eSortAqlList.concat(vSortAqlList);
    }
    const sortAql = this.getSortAql(allSortAqlList);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options, 'v');
    // 转义静态数据
    const staticDataAQL = this.getStaticDataAql(_params.options);

    const collectionName = this.getCollectionName();
    const collection = this.aql.literal(collectionName);
    const collectionNames = this.aql.literal(this.getWithCollectionNames());
    // const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      WITH ${collectionNames}
      LET tsl = (
        LET list = (
          FOR v, e, p
          IN ${depthAql}
          ${this.aql.literal(direction)} '${startIdSql}'
          GRAPH '${collection}'
          //OPTIONS { bfs: true, uniqueVertices: 'path' }
          //FILTER v._status == true and e._status == true
          FILTER p.vertices[*]._status ALL == true and p.edges[*]._status ALL == true
          ${vFilterAql} ${eFilterAql}
            ${sortAql}
          // 每一项取最后两个数据作为父子关系
          // RETURN p.vertices[*] 
          // 直接拼接父子关联
          RETURN ${resAQL}
        )
        ${staticDataAQL}
      )
      RETURN tsl`;
      // RETURN {${collections}: tsl}`;
    return this.convertArrayToObject(await this.query(query));
  }

}

module.exports = BaseDao;

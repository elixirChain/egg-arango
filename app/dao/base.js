'use strict';

const Joi = require('@hapi/joi');
const pluralize = require('pluralize');
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
 *  - 其他数据访问处理：https://git.eduszs.com/szs-rd/base/server-base/blob/master/BaseDao.md
 *
 * @refer:
 * https://www.arangodb.com/docs/3.4/aql/data-queries.html
 * https://www.arangodb.com/docs/3.4/aql/graphs-traversals.html
 * - WITH: optional for single server instances, but required for graph traversals in a cluster.
 */
class BaseDao {
  constructor(_ctx) {
    this.ctx = _ctx;
    this.aql = this.ctx.app.aql;
    this.arango = this.ctx.app.arango;
    this.logger = this.ctx.logger;
    // 处理业务异常
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
    this.unsetRes = [ '_rev', '_key', '_status', 'password', '_token', '_token_expire_date' ];
    // 排序对象验证
    this.sortSchema = Joi.array().min(1).items(
      Joi.object({
        field: Joi.string().required(),
        direction: Joi.string().valid('', 'asc', 'desc', 'ASC', 'DESC'),
      }).required());
    // 通用查询过滤条件验证
    this.filterMinSchema = Joi.object().min(1).pattern(/.*/, Joi.any().invalid('', null, NaN, Infinity).required());
    this.filterSchema = Joi.object().pattern(/.*/, Joi.any().invalid('', null, NaN, Infinity).required());
    // 边表查询Options
    this.optionsSchema = Joi.object({
      // return {v, e}, default return v.
      hasEdge: Joi.boolean(),
      keepAttrs: Joi.string(),
    });
    // 模糊匹配条件验证
    this.likeSchema = Joi.object({
      or: Joi.array().min(1).items(
        Joi.object({
          field: Joi.string().required(),
          search: Joi.string().required(),
        }).required()),
      and: Joi.array().min(1).items(
        Joi.object({
          field: Joi.string().required(),
          search: Joi.string().required(),
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
      if (error !== null) {
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
   * - （单数类型）默认双等号匹配
   * - array类型使用in匹配
   * @param {object} filter 查询单数对象
   * @param {string} alias alias of collection
   * @return {AQL} obj
   */
  getFilterAql(filter, alias) {
    // 默认别名为't'
    if (!alias) {
      alias = 't';
    }
    alias = this.aql.literal(alias);

    const filterAqlList = [];
    let filterAql;
    if (filter) {
      for (const key in filter) {
        if (Array.isArray(filter[key])) {
          // 支持数组参数
          filterAqlList.push(this.aql` and ${alias}.${key} in ${filter[key]}`);
        } else {
          // 单个参数
          filterAqlList.push(this.aql` and ${alias}.${key} == ${filter[key]}`);
        }
      }
      if (filterAqlList.length !== 0) {
        filterAql = this.aql.join(filterAqlList);
      }
    }
    return filterAql;
  }

  /**
   * 拼装like条件
   * - or（or连接）
   * - and（and连接）
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
    // 分别处理or 和 and 对象
    if (like) {
      like.or && like.or.forEach((el, idx) => {
        if (idx === 0) {
          orAqlList.push(this.aql`\nFILTER `);
        }
        if (idx === like.or.length - 1) {
          orAqlList.push(this.aql`LIKE(${alias}.${el.field}, ${el.search}) `);
        } else {
          orAqlList.push(this.aql`LIKE(${alias}.${el.field}, ${el.search}) or `);
        }
      });
      like.and && like.and.forEach(el => {
        andAqlList.push(this.aql`\nFILTER LIKE(${alias}.${el.field}, ${el.search})`);
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
    // 添加到开头
    sortFieldAqlList.unshift(this.aql` SORT `);
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

    let sortAqlList = [ this.aql` ${alias}._create_date desc ` ];
    const fieldAqlList = [];
    if (sorts) {
      sorts && sorts.forEach((el, idx) => {
        if (idx === sorts.length - 1) {
          fieldAqlList.push(this.aql`${alias}.${el.field} ${!el.direction ? '' : el.direction} `);
        } else {
          fieldAqlList.push(this.aql` ${alias}.${el.field} ${!el.direction ? '' : el.direction}, `);
        }
      });
      // 拼装AQL
      if (fieldAqlList.length !== 0) {
        sortAqlList = fieldAqlList;
      }
    }
    return sortAqlList;
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
    // 默认别名为't'
    let edgeFlag = true;
    if (!alias) {
      alias = 't';
      edgeFlag = false;
    }
    alias = this.aql.literal(alias);
    // 响应结果处理函数: 默认'UNSET'
    let func = this.aql.literal('UNSET');

    // 无配置，默认响应
    if (!options) {
      if (edgeFlag) {
        return this.aql`MERGE(${func}(${alias}, ${this.unsetRes}), {_from: e._from, _to:e._to})`;
      }
      return this.aql`${func}(${alias}, ${this.unsetRes})`;
    }

    // 响应结构默认排除属性
    let keepAttrs = this.unsetRes;
    if (options.keepAttrs && options.keepAttrs.trim() !== '') {
      // 保留属性函数
      func = this.aql.literal('KEEP');
      // 剔除传入保留属性中含有的默认排除属性
      keepAttrs = options.keepAttrs.split(',').filter(v => !this.unsetRes.includes(v));
    }
    // 处理边表响应
    if (options.hasEdge) {
      return this.aql`{ vertex: ${func}(${alias}, ${keepAttrs}), edge: ${func}(e, ${keepAttrs}) }`;
    }

    if (edgeFlag) {
      // 边表文档：默认merge边数据（_from, _to）
      return this.aql`${func}(${alias}, ${keepAttrs})`;
    }

    // 普通文档
    return this.aql`${func}(${alias}, ${keepAttrs})`;
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

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      FOR t IN ${collection} 
        FILTER t._id == ${_params._id} && t._status == true 
      RETURN ${resAQL}`;
    const objs = await this.query(query);
    // 验证唯一性
    this.validateData(Joi.array().max(1), objs);
    return { [this.getLowerCollectionName()]: this.convertArrayToObject(objs) };
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
        filter: this.filterMinSchema.required(),
        options: this.optionsSchema,
      }),
      _params
    );

    // 修改为使用FILTER可以利用索引
    const filterAql = this.getFilterAql(_params.filter);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options);

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      FOR t IN ${collection} 
        FILTER t._status == true ${filterAql}
      RETURN ${resAQL}`;
    const objs = await this.query(query);
    // 验证唯一性
    this.validateData(Joi.array().max(1), objs);
    return { [this.getLowerCollectionName()]: this.convertArrayToObject(objs) };
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
   * @param {array} _params.sorts - array of sort str for attrs.
   * @param {object} _params.options - query options, e.g. keepAttrs-res attrs; hasEdge-edge res;
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async getsByFilter(_params) {
    this.validateData(
      Joi.object({
        filter: this.filterMinSchema.required(),
        sorts: this.sortSchema,
        options: this.optionsSchema,
      }).required(),
      _params
    );

    // 修改为使用FILTER可以利用索引
    const filterAql = this.getFilterAql(_params.filter);
    // 拼装排序条件 默认创建时间倒序
    const sortAql = this.getSortAql(this.getSortFieldAqlList(_params.sorts));
    // 获取响应结构
    const resAQL = this.getResAql(_params.options);

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
    LET tsl = ( 
      FOR t IN ${collection} 
        FILTER t._status == true ${filterAql}
        ${sortAql}
      RETURN ${resAQL}
    )
    RETURN {${collections}: tsl}`;
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
        filter: this.filterSchema,
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

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      LET ts = ( 
        FOR t IN ${collection} 
          FILTER t._status == true ${filterAql} ${orAql} ${andAql} 
          ${sortAql}
        RETURN ${resAQL} 
      ) 
      LET tsl = ( 
        FOR tl IN ts 
          LIMIT ${_params.offset},${_params.count} 
        RETURN tl 
      ) 
      LET totalCount = LENGTH(ts) 
      LET flag = (${_params.offset} + ${_params.count} >= totalCount) 
      LET end = flag ? totalCount : ${_params.offset} + ${_params.count} 
      LET hasMore = !flag 
      RETURN {total_count:totalCount, has_more:hasMore, end:end, ${collections}:tsl}`;
    return this.convertArrayToObject(await this.query(query));
  }

  /**
   * save single document
   * @param {object} doc - the new document
   * @return {AqlQuery} - interface AqlQuery by arangodb
   */
  async save(doc) {
    this.validateData(this.filterMinSchema.required(), doc);
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
    this.validateData(Joi.array().min(1).items(this.filterMinSchema.required()), docs);
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
        newObj: this.filterMinSchema.required(),
      }).required(),
      _params
    );
    const update_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    LET key = PARSE_IDENTIFIER(${_params._id}).key 
    UPDATE key WITH MERGE(UNSET(${_params.newObj}, ${this.unset}), { _update_date:${update_date}})
    IN ${collection} 
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
        newObj: this.filterMinSchema.required(),
      }).required(),
      _params
    );
    const update_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    let tsl = (
      FOR t IN ${_params._ids}
        LET key = PARSE_IDENTIFIER(t).key 
        UPDATE key WITH MERGE(UNSET(${_params.newObj}, ${this.unset}), { _update_date:${update_date}})
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
          newObj: this.filterMinSchema.required(),
        }))
        .required(),
      _params
    );
    const update_date = moment().format('YYYY-MM-DD HH:mm:ss');
    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
    let tsl = (
      FOR t IN ${_params}
        LET key = PARSE_IDENTIFIER(t._id).key 
        UPDATE key WITH MERGE(UNSET(t.newObj, ${this.unset}) , { _update_date:${update_date}})
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

    const collection = this.aql.literal(`${this.getCollectionName()}`);
    const query = this.aql`
      let tsl = (
        FOR t IN ${collection} 
        FILTER t._status == true ${filterAql}
        UPDATE t WITH { _status: false } IN ${collection}
        RETURN NEW._id
      )
      RETURN {_ids: tsl}`;

    const objs = await this.query(query);
    // 验证是否保存成功
    this.validateData(Joi.array().min(1), objs);
    return this.convertArrayToObject(objs);
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
        attrs: this.filterMinSchema,
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
        attrs: this.filterMinSchema,
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
        v_filter: this.filterSchema,
        e_filter: this.filterSchema,
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
    const vSortAqlList = this.getSortFieldAqlList(_params.v_sorts, 'v');
    const eSortAqlList = this.getSortFieldAqlList(_params.e_sorts, 'e');
    vSortAqlList.concat(eSortAqlList);
    const sortAql = this.getSortAql(vSortAqlList);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options, 'v');

    const collectionName = this.getCollectionName();
    const collection = this.aql.literal(collectionName);
    const collectionNames = this.aql.literal(this.getWithCollectionNames());
    const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      WITH ${collectionNames}
      LET tsl = ( 
        FOR v,e IN ${this.aql.literal(direction)} ${_params._id} ${collection} 
          FILTER v._status == true && e._status == true ${vFilterAql} ${eFilterAql}
          ${sortAql}
        RETURN ${resAQL}
      )
      RETURN {${collections}: tsl}`;
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
        v_filter: this.filterSchema,
        e_filter: this.filterSchema,
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

    // 拼装排序条件 默认创建时间倒序
    const vSortAqlList = this.getSortFieldAqlList(_params.v_sorts, 'v');
    const eSortAqlList = this.getSortFieldAqlList(_params.e_sorts, 'e');
    vSortAqlList.concat(eSortAqlList);
    const sortAql = this.getSortAql(vSortAqlList);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options, 'v');

    const collectionName = this.getCollectionName();
    const collection = this.aql.literal(collectionName);
    const collectionNames = this.aql.literal(this.getWithCollectionNames());
    const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      WITH ${collectionNames}
      LET vs = ( 
        FOR v,e IN ${this.aql.literal(direction)} ${_params._id} ${collection} 
          FILTER v._status == true && e._status == true ${vFilterAql} ${eFilterAql}
          ${sortAql}
          RETURN ${resAQL} 
      ) 
      LET vsl = ( 
        FOR vl IN vs 
          LIMIT ${_params.offset},${_params.count} 
        RETURN vl 
      ) 
      LET totalCount = LENGTH(vs) 
      LET flag = (${_params.offset} + ${_params.count} >= totalCount) 
      LET end = flag ? totalCount : ${_params.offset} + ${_params.count} 
      LET hasMore = !flag 
      RETURN {total_count:totalCount, has_more:hasMore, end:end, ${collections}:vsl}`;
    return this.convertArrayToObject(await this.query(query));
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
   * @param {integer} _params.depth - the depth of the graph
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
        v_filter: this.filterSchema,
        e_filter: this.filterSchema,
        v_sorts: this.sortSchema,
        e_sorts: this.sortSchema,
        options: this.optionsSchema,
      }).required(),
      _params
    );

    // 修改为使用FILTER可以利用索引
    let depth = _params.depth;
    if (!depth || depth < 1) {
      depth = 1;
    }
    const depthAql = this.aql.literal(`1..${depth}`);
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
    const vSortAqlList = this.getSortFieldAqlList(_params.v_sorts, 'v');
    const eSortAqlList = this.getSortFieldAqlList(_params.e_sorts, 'e');
    vSortAqlList.concat(eSortAqlList);
    const sortAql = this.getSortAql(vSortAqlList);
    // 获取响应结构
    const resAQL = this.getResAql(_params.options, 'v');

    const collectionName = this.getCollectionName();
    const collection = this.aql.literal(collectionName);
    const collectionNames = this.aql.literal(this.getWithCollectionNames());
    const collections = this.aql.literal(`${pluralize(this.getLowerCollectionName())}`);
    const query = this.aql`
      WITH ${collectionNames}
      LET tsl = ( 
        FOR v, e, p
        IN ${depthAql}
        ${this.aql.literal(direction)} '${startIdSql}'
        GRAPH '${collection}'
        //OPTIONS { bfs: true, uniqueVertices: 'path' }
        FILTER v._status == true and e._status ${vFilterAql} ${eFilterAql}
          ${sortAql}
        // 每一项取最后两个数据作为父子关系
        // RETURN p.vertices[*] 
        // 直接拼接父子关联
        RETURN ${resAQL}
      )
      RETURN {${collections}: tsl}`;
    return this.convertArrayToObject(await this.query(query));
  }

}

module.exports = BaseDao;

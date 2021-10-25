const requester = require('cote-requester');
const logger = require('logger');
// const Redis = require('ioredis');

const customerReq = requester('md-customers', 'md-customers');

// const redisConfig = {
//   host: process.env.REDIS_HOST,
//   port: process.env.REDIS_PORT,
//   password: process.env.REDIS_PASSWORD,
//   tls: {},
//   connectTimeout: 30000,
// };

// if (process.env.NODE_ENV !== 'production') {
//   delete redisConfig.tls;
// }

// const redis = new Redis(redisConfig);

// eslint-disable-next-line arrow-body-style
module.exports = async (shop) => {
  // const key = `custIntegrCache${companyId}${shop}`;
  // let integration = await redis.get(key)
  //   .then((data) => {
  //     let result;
  //     try {
  //       result = JSON.parse(data);
  //     } catch (e) {
  //       logger.error(e);
  //     }
  //     return result;
  //   });

  // if (!integration) {
  return customerReq
    .send('customer.integration.get', {
      name: shop,
      retrieve: 'customer',
    })
    .then(({ data }) => {
      if (!data || !Array.isArray(data) || data.length !== 1) return false;
      // redis.setex(key, 1, JSON.stringify(data[0]));
      return data[0];
    })
    .catch((err) => {
      logger.error('customer.integration.get err', err);
      return err;
    });
  // }

  // return integration;
};

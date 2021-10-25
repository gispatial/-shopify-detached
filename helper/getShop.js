const axios = require('axios');
const Redis = require('ioredis');
const logger = require('logger');

const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  tls: {},
  connectTimeout: 30000,
};

if (process.env.NODE_ENV !== 'production') {
  delete redisConfig.tls;
}

const redis = new Redis(redisConfig);

module.exports = async (shop, access_token) => {
  const key = `shopifyShop${shop}`;
  let shopData = await redis.get(key)
    .then((data) => {
      let result;
      try {
        result = JSON.parse(data);
      } catch (e) {
        logger.error(e);
      }
      return result;
    });

  if (!shopData) {
    const url = `https://${shop}/admin/api/2021-07/shop.json`;
    shopData = await axios
      .get(url, {
        headers: { 'X-Shopify-Access-Token': access_token },
      })
      .then(({ data, status }) => {
        const { shop: res } = data;
        redis.setex(key, 60, JSON.stringify(res));
        return res;
      });
  }

  return shopData;
};

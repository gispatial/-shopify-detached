const axios = require('axios');
const Redis = require('ioredis');

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

module.exports = async (currency) => {
  const key = `curExchg${currency}`;
  let rate = await redis.get(key);
  if (!rate) {
    rate = await axios
      .get(`https://openexchangerates.org/api/latest.json?app_id=e59e163f4440470e84342ab744b150b3&symbols=${currency}`)
      .then(({ data, status }) => {
        const currentRate = 1 / data.rates[currency];
        redis.setex(key, 21600, currentRate); // cache 8 hrs
        return currentRate;
      });
  }

  return rate;
};

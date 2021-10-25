const logger = require('logger');
const Redis = require('ioredis');
const axios = require('axios');

// if locationId defined > return {}
// if locationId undefined > return [{}]
function getLocations(shop, access_token, locationId) {
  const url = locationId
    ? `https://${shop}/admin/api/2021-07/locations/${locationId}.json`
    : `https://${shop}/admin/api/2021-07/locations.json`;

  return axios
    .get(url, {
      headers: { 'X-Shopify-Access-Token': access_token },
    })
    .then(({ data, status }) => {
      logger.debug('getLocations response', data, status);

      if (data.location) return Promise.resolve(data.location);

      const locations = data.locations
        .filter(l => l.active === true)
        .map(l => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          address1: l.address1,
          address2: l.address2,
          city: l.city,
          state: l.province,
          postcode: l.zip,
          country: l.country,
        }));

      return Promise.resolve(locations);
    })
    .catch((error) => {
      logger.error('getLocations err', error.message, error.response.data);
      return Promise.reject(error.message);
    });
}

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

module.exports = async (shop, access_token, locationId) => {
  const key = `shopifyLocation${shop}${locationId}`;
  const location = await redis.get(key)
    .then((data) => {
      let result;
      try {
        result = JSON.parse(data);
      } catch (e) {
        logger.error(e);
      }
      return result;
    });

  if (!location) {
    return getLocations(shop, access_token, locationId)
      .then((locations) => {
        redis.setex(key, 60, JSON.stringify(locations));
        return locations;
      })
      .catch((err) => {
        logger.error('Shopify getLocation ERR', err);
        return Promise.reject(err);
      });
  }

  return location;
};

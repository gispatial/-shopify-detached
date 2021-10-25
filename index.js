const express = require('express');
const axios = require('axios');
const path = require('path');
const logger = require('logger');
const ShopifyToken = require('shopify-token');
const requester = require('cote-requester');
const moment = require('moment');
const isEmpty = require('is-empty');
const crypto = require('crypto');
const cote = require('cote');

const token = require('../../../lib/validate').validate;

const router = express.Router();
const customerReq = requester('md-customers', 'md-customers');
const authReq = requester('auth', 'auth');
const serviceReq = requester('dx-service', 'dx-service requester');
const orderReq = requester('md-orders', 'md-orders');
const walletReq = requester('md-wallet', 'md-wallet');

const getIntegration = require('./helper/getIntegration');
const getLocations = require('./helper/getLocations');
const getShop = require('./helper/getShop');
const getCurrencyExchange = require('./helper/getCurrencyExchange');
const Order = require('./order');

const orderTrackingStream = new cote.Subscriber({
  name: 'shopify@gateway',
  key: 'md-orders',
  subscribesTo: ['order_tracking.update_w_extid', 'order.processed'],
});

const shopify_config = {
  apiKey: 'efddbb975fcebd4df54db017f96cad16',
  sharedSecret: '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',
};

// "Promise.allSettled" polyfill. This is available natively from Node 12.9.0 - Suhaimi
if (!Promise.allSettled) {
  Promise.allSettled = promises => Promise.all(
    promises.map((promise, i) => promise
      .then(value => ({
        status: 'fulfilled',
        value,
      }))
      .catch(reason => ({
        status: 'rejected',
        reason,
      }))),
  );
}

function checkIfEmpty(string) {
  return isEmpty(string) ? '' : string;
}

// useful little code to pick certain object key
// how to use? pick('key1', 'key2')(obj)
const pick = (...props) => o => props.reduce((a, e) => ({ ...a, [e]: o[e] }), {});

// delyva now, temporarily hardcoded
// const CompanyId = 'b12b9045-82f9-40f6-9a87-cdf9bb25f281';
// const CompanyId = '2cab0b07-7a5d-4971-aeba-5ffac537a455';

const apiEndpoint = process.env.NODE_ENV !== 'production'
  ? 'https://staging-api.delyva.app'
  : 'https://api.delyva.app';

router.use('/app', express.static(path.join(__dirname, 'app/out')));

function f(promise, res, successStatus = 200, failedStatus = 400) { // eslint-disable-line
  return promise
    .then(data => res.status(successStatus).json(data))
    .catch(err => res.status(failedStatus).json(err.message || err));
}

function getToken(shop, redirect_url) {
  if (typeof shop === 'undefined' || shop === '' || shop === null) {
    return Promise.reject(new Error('Invalid Shop'));
  }

  shopify_config.shop = shop;
  shopify_config.redirectUri = redirect_url;
  const shopifyToken = new ShopifyToken(shopify_config);

  // generate random nonces
  const nonce = shopifyToken.generateNonce();

  // generate shopify authorization URL
  const uri = shopifyToken.generateAuthUrl(shopify_config.shop, ['read_orders', 'write_orders', 'read_shipping', 'write_shipping', 'write_fulfillments'], nonce);

  return Promise.resolve({
    shop,
    state: nonce,
    url: uri,
  });
}

async function getCustomer(companyId, customerId) {
  const query = { companyId, id: customerId };
  return customerReq.send('customers.get', query)
    .then(data => pick('id', 'name', 'email', 'walletBalance', 'selectedServices')(data.data))
    .catch((err) => {
      logger.error('shopify getCustomer ERR', err);
      return err;
    });
}

function verifyHmac(query) {
  const shopifyToken = new ShopifyToken({
    ...shopify_config,
    shop: query.shop,
    redirectUri: query.redirect_uri || 'https://my.delyva.app/customer/integration/setup',
  });
  return shopifyToken.verifyHmac(query);
}

// async function shopIsExists(shop, access_token) {
//   logger.debug('getShopifyStore', shop, access_token);
//   const url = `https://${shop}/admin/api/2021-07/shop.json`;

//   return axios
//     .get(url, {
//       headers: { 'X-Shopify-Access-Token': access_token },
//     })
//     .then(({ data, status }) => {
//       logger.debug('getShopifyStore response', data, status);
//       const { shop: res } = data;
//       logger.debug('shop, res.domain', shop, res.domain);
//       if (shop === res.domain) return Promise.resolve(true);
//       return Promise.resolve(false);
//     })
//     .catch((error) => {
//       logger.error('getShopifyStore err', error.message, error.response.data);
//       return Promise.reject(error.message);
//     });
// }

// register webhook
function registerWebhook(shopDomain, access_token, topic) {
  logger.debug('shopify registerWebhook', shopDomain, access_token, topic);
  const url = `https://${shopDomain}/admin/api/2021-07/webhooks.json`;

  return axios
    .post(url, {
      webhook: {
        topic,
        address: `${apiEndpoint}/shopify/webhook/${topic.replace('/', '-')}`,
        format: 'json',
      },
    }, {
      headers: { 'X-Shopify-Access-Token': access_token },
    })
    .then((response) => {
      if (response.status === 201) {
        return Promise.resolve(response.data.webhook);
      }
      return Promise.reject(new Error('Unkonwn Error'));
    })
    .catch((error) => {
      logger.error('registerWebhook err', error.message, error.response.data);
      return Promise.reject(error.message);
    });
}

async function registerCarrierService(shopDomain, access_token) {
  logger.debug('registerCarrierService', shopDomain, access_token);
  const url = `https://${shopDomain}/admin/api/2021-07/carrier_services.json`;

  const carriers = await axios
    .get(url, {
      headers: { 'X-Shopify-Access-Token': access_token },
    })
    .then(response => response.data.carrier_services)
    .catch((error) => {
      logger.error('registerCarrierService err', error.message, error.response.data);
      return {};
    });

  // register if not
  let exist = false;

  Object.entries(carriers).forEach(([key, value]) => {
    if (value.name === 'Delyva') {
      exist = true;
    }
  });

  if (exist) {
    return true;
  }

  return axios
    .post(url, {
      carrier_service: {
        name: 'Delyva',
        callback_url: `${apiEndpoint}/shopify/getRates/${shopDomain}`,
        service_discovery: 'json',
      },
    }, {
      headers: { 'X-Shopify-Access-Token': access_token },
    })
    // .then(response => {
    //   // console.log('registerCarrierService', response)
    // })
    .catch((error) => {
      logger.error('shopify registerCarrierService err', error.response.data);
    });
}

router.get('/print_cn', (req, res) => {
  // const shop = req.query.shop;
  res.status(200).send('ok');
});

router.post('/webhook/:topic?', async (req, res) => {
  const {
    'x-shopify-topic': topic,
    'x-shopify-shop-domain': shop,
    'x-shopify-hmac-sha256': hmac,
  } = req.headers;
  logger.debug('shopify webhook', shop, topic);

  const hash = crypto
    .createHmac('sha256', shopify_config.sharedSecret)
    .update(res.locals.rawBody, 'utf8', 'hex')
    .digest('base64');

  // verify if this request is legit
  if (hash !== hmac) {
    console.log(`${hash} !== ${hmac}`); // eslint-disable-line
    return res.sendStatus(403);
  }

  const integration = await getIntegration(shop);

  if (integration.error) {
    logger.error('shopify webhook err 1', integration.error);
    return res.status(400).json({ error: integration.error });
  }

  if (!integration) {
    logger.error('shopify webhook err 2', integration);
    return res.status(200).json({ error: 'App is not installed' });
  }

  if (topic === 'fulfillments/create') {
    return Order.create(req, res, integration);
  } if (topic === 'app/uninstalled') {
    return customerReq
      .send('customer.integration.delete', {
        id: integration.id,
        companyId: integration.companyId,
      })
      .then((data) => {
        logger.debug('customer.integration.delete SUCCESS', data);
        return res.sendStatus(200);
      })
      .catch((err) => {
        logger.error('delete integration err', err);
        return res.sendStatus(400);
      });
    // TODO: uninstall app
  }

  logger.error('invalid topic', topic);
  return res.status(400).send('Invalid topic');
});

const defaultIntegrationSettings = {
  import_opt: 'auto', // auto | manual
  pickup_date: 0, // 0=sameday, 1=+1, 2=+2
  pickup_time: '10:00',
  item_type: 'PARCEL',
};


// attach customer to integration
router.post('/attach', token('shopify.attach'), async (req, res) => {
  const input = req.body;
  input.userId = res.locals.user.id;
  input.companyId = res.locals.user.companyId;

  const {
    companyId,
    customerId,
    shop,
    integrationId,
    userId,
  } = input;

  if (!input.customerId || input.customerId <= 0) {
    return res.status(400).json({ error: '"customerId" is required' });
  }

  const integration = await getIntegration(shop);

  if (integration.error) {
    return res.status(400).json({ error: integration.error });
  }

  if (!integration) {
    return res.status(404).json({ error: 'App is not installed' });
  }

  logger.debug('integration', JSON.stringify(integration));

  const customer = await getCustomer(input.companyId, input.customerId);
  if (customer.error) {
    logger.error('get customer error', customer.error);
    return res.status(400).json({ error: customer.error });
  }

  logger.debug('customer', customer);

  const defaultSettings = defaultIntegrationSettings;

  const updatedData = {
    id: integrationId,
    companyId,
    customerId,
    userId,
    settings: defaultSettings,
    status: 1,
  };

  const updateIntegration = await customerReq
    .send('customer.integration.update', updatedData)
    .then((data) => {
      logger.debug('customer.integration.update SUCCESS', data);
      return data;
    })
    .catch((err) => {
      logger.error('update integration err', err);
      return err;
    });

  if (updateIntegration.error) {
    return res.status(400).json({ error: updateIntegration.error || integration });
  }

  const jwt = await authReq.send('auth.getTokenByUserId', {
    userId,
    companyId,
  });

  const shopData = await getShop(shop, integration.metadata.accessToken)
    .catch(() => {
      res.sendStatus(400);
      return 'ERR';
    });

  const perUsd = shopData.currency === 'USD' ? 1 : await getCurrencyExchange(shopData.currency);

  // if found, and everything good, return integration id and customer id and jwt token
  return res.status(200).json({
    data: {
      integrationId: integration.id,
      companyId: input.companyId,
      userId,
      customer,
      jwt,
      status: integration.status,
      perUsd,
      currency: shopData.currency,
    },
  });
});

router.post('/getRates/:shop', async (req, res) => {
  // eslint-disable-next-line object-curly-newline
  logger.info('SHOPIFY GETRATES', { headers: req.headers, body: req.body, query: req.query, params: req.params });
  const origin = req.body.rate.origin;
  const dest = req.body.rate.destination;
  const items = req.body.rate.items;
  const { shop } = req.params;

  const pickUpDate = moment().tz('Asia/Kuala_Lumpur'); // TODO: ikut timezone company
  pickUpDate.add(1, 'days');
  pickUpDate.hour(10);
  pickUpDate.minute(0);

  if (pickUpDate.day() === 0) { // Ahad
    pickUpDate.add(1, 'days'); // Tukar jadi Isnin
  } else if (pickUpDate.day() === 6) { // Sabtu
    pickUpDate.add(2, 'days'); // Tukar jadi Isnin
  }

  let totalItemWeight = 0;

  Object.entries(items).forEach(([key, item]) => {
    totalItemWeight += parseFloat(item.grams);
  });

  totalItemWeight *= 0.001;

  logger.debug('shopify get integration', shop);
  const integration = await getIntegration(shop);

  logger.debug('shopify integration', integration);

  const { customer, settings } = integration;
  const { id: customerId } = customer;

  const instantQuote = {
    companyId: integration.companyId,
    customerId,
    origin: {
      address1: origin.address1,
      address2: checkIfEmpty(origin.address2),
      city: checkIfEmpty(origin.city),
      state: checkIfEmpty(origin.province),
      postcode: checkIfEmpty(origin.postal_code),
      country: origin.country,
    },
    destination: {
      address1: dest.address1,
      address2: checkIfEmpty(dest.address2),
      city: checkIfEmpty(dest.city),
      state: checkIfEmpty(dest.province),
      postcode: checkIfEmpty(dest.postal_code),
      country: dest.country,
    },
    weight: {
      value: totalItemWeight,
      unit: 'kg',
    },
  };

  if (settings.item_type && settings.item_type !== '') {
    instantQuote.itemType = String(settings.item_type);
  }

  logger.debug('shopify instant quote', instantQuote);

  serviceReq
    .send('service.quote', instantQuote)
    .then(({ data, errors }) => {
      const services = data.services;

      if (errors.length > 0 || services.length === 0) {
        return res.sendStatus(400);
      }

      const rates = services.map(({ service, price }) => ({
        service_name: service.name,
        service_code: service.code,
        description: service.code,
        total_price: Number.parseFloat(price.amount) * 100,
        currency: price.currency,
        phone_required: true,
      }));

      logger.debug('shopify rates response', rates);

      return res.status(200).json({ rates });
    })
    .catch((err) => {
      logger.error('SHOPIFY GETRATES ERR', err);
      res.sendStatus(400);
    });
});

// init shopify app
router.get('/init', token('shopify.init', false), async (req, res) => {
  let shop = req.query.shop;
  if (shop && shop.match(/^[a-zA-Z]+:\/\//)) {
    shop = new URL(req.query.shop).hostname;
  }

  if (!verifyHmac(req.query)) {
    res.status(403).send('Unauthorized');
    return;
  }

  // find if integration with "shop" name exists
  const integration = await getIntegration(shop);

  if (integration.error) {
    res.status(400).json({ error: integration.error });
    return;
  }

  if (!integration) {
    res.status(404).json({ error: 'App is not installed' });
    return;
  }

  const shopData = await getShop(shop, integration.metadata.accessToken)
    .catch(() => {
      res.sendStatus(400);
      return 'ERR';
    });

  // check if this shop exists in shopify, or dah uninstall?
  const exists = shopData.domain === shop;

  logger.debug('shopIsExists', shop, exists);
  if (exists === 'ERR') return;
  if (exists === false) {
    // await customerReq
    //   .send('customer.integration.delete', {
    //     id: integration.id,
    //     companyId: integration.companyId,
    //   })
    //   .then((data) => {
    //     logger.debug('shopIsExists integration.delete SUCCESS', data);
    //   })
    //   .catch((err) => {
    //     logger.error('shopIsExists integration.delete ERR', err);
    //   });

    res.sendStatus(404);
    return;
  }

  if (integration.status === 0) {
    res.status(400).json({ error: 'App is inactive' });
    return;
  }

  const locations = await getLocations(shop, integration.metadata.accessToken)
    .catch(() => []);

  if (!integration.customerId) {
    res.status(200).json({
      data: {
        integrationId: integration.id,
        companyId: integration.companyId,
        shop: integration.name,
        status: integration.status,
        locations,
      },
    });
    return;
  }

  let customer;
  let jwt = null;

  if (integration.companyId) {
    customer = await getCustomer(integration.companyId, integration.customerId);
    if (customer.error) {
      res.status(400).json({ error: customer.error });
      return;
    }

    if (!res.locals.user) {
      jwt = await authReq.send('auth.getTokenByUserId', {
        userId: integration.userId,
        companyId: integration.companyId,
      });
    }
  }

  const perUsd = shopData.currency === 'USD' ? 1 : await getCurrencyExchange(shopData.currency);

  const responseData = {
    integrationId: integration.id,
    companyId: integration.companyId,
    userId: integration.userId,
    customer,
    jwt,
    status: integration.status,
    locations,
    currency: shopData.currency,
    perUsd,
  };

  if (!integration.metadata.accessToken) {
    logger.debug('shopify access token not found', shop, { metadata: integration.metadata });
    res.sendStatus(404);
    return;
  }

  // if found, and everything good, return integration id and customer id and jwt token
  res.status(200).json({
    data: responseData,
  });
});

// install shopify app
router.get('/install', token('shopify.install', false), async (req, res) => {
  const { customerId } = req.query;
  if (!customerId && !verifyHmac(req.query)) {
    return res.status(403).send('Unauthorized. Invalid hmac');
  }

  const input = req.query;
  input.shop = req.query.shop;

  if (!input.companyId && res.locals.user && res.locals.user.companyId) {
    input.companyId = res.locals.user.companyId;
  }

  // check if shop exists in customer integration
  let integration = await getIntegration(input.shop);

  if (integration.error) {
    return res.status(400).json({ error: integration.error });
  }

  // insert new integration data
  if (!integration) {
    const newIntegration = {
      companyId: input.companyId,
      name: input.shop,
      type: 'shopify',
      status: 2, // 2 = pending
    };

    // If install from customer portal, these values are available
    if (input.companyId && customerId) {
      const customer = await getCustomer(input.companyId, customerId);
      if (customer.error) {
        logger.error('get customer error', customer.error);
        return res.status(400).json({ error: customer.error });
      }

      newIntegration.customerId = customerId;
      newIntegration.userId = customer.userId;
      newIntegration.status = 1;
      newIntegration.settings = defaultIntegrationSettings;
    }

    logger.debug('new shopify integration, creting new record', newIntegration);
    integration = await customerReq
      .send('customer.integration.create', newIntegration)
      .catch(err => err);

    if (integration.error) {
      logger.error('create integration error', integration.error);
      return res.status(400).json({ error: integration.error });
    }
  }

  logger.debug('shopify integration install', integration);

  if (!integration) {
    return res.status(400).json({ error: 'Internal server error: Failed to create integration' });
  }

  const callbackUrl = `${apiEndpoint}/v1.0/shopify/install2`;

  // if not installed, connect to shopify
  return getToken(input.shop, callbackUrl)
    .then((data) => {
      logger.debug('getToken data', data);
      logger.info('redirect to', data.url);
      res.redirect(data.url);
    })
    .catch(err => res.status(400).json(err.message || err));
});

// callback from shopify, continue installation process
router.get('/install2', async (req, res) => {
  const {
    code,
    shop,
  } = req.query;

  const urlParams = new URLSearchParams(req.query);

  const redirectUri = `${apiEndpoint}/v1.0/shopify/app?${urlParams.toString()}`;

  // check if shop exists in customer integration
  const integration = await getIntegration(shop);

  if (integration.error) {
    res.status(400).json({ error: integration.error });
    return;
  }

  if (integration && integration.status === 1) {
    res.redirect(redirectUri);
    return;
  }

  const {
    customerId,
  } = integration;

  const shopifyToken = new ShopifyToken({
    ...shopify_config,
    shop,
    redirectUri, // tak perlu, tp required
  });

  const hmacVerified = shopifyToken.verifyHmac(req.query);

  if (!hmacVerified) {
    res.status(400).json({
      error: 'Unauthorized. Invalid hmac',
    });
    return;
  }

  // Exchange the authorization code for a permanent access token.
  try {
    const { access_token: accessToken, scope } = await shopifyToken.getAccessToken(shop, code);
    const updatedData = {
      id: integration.id,
      name: shop,
      status: 1,
      metadata: {
        accessToken,
        scope,
      },
    };

    if (customerId) updatedData.customerId = customerId;

    // save/update access token in customer integration db
    const updateIntegration = await customerReq
      .send('customer.integration.update', updatedData)
      .then((data) => {
        logger.debug('customer.integration.update SUCCESS', data);
        return data;
      })
      .catch((err) => {
        logger.error('update integration err', err);
        return err;
      });

    if (updateIntegration.error) {
      res.status(400).json({ error: updateIntegration.error || integration });
      return;
    }

    const initEssential = [];

    // register webhook
    initEssential.push(registerWebhook(shop, accessToken, 'fulfillments/create'));
    initEssential.push(registerWebhook(shop, accessToken, 'app/uninstalled'));

    // register carrier service
    initEssential.push(registerCarrierService(shop, accessToken));

    Promise.allSettled(initEssential)
      .then(() => {
        res.redirect(`https://${shop}/admin/apps/delyvax`);
        // res.redirect(redirectUri);
        // res.status(200).json({
        //   data: `Successfully connected to "${shop}"`,
        // });
      })
      .catch((err) => {
        logger.error('shopify initEssentia ERR', err);
      });
    return;
  } catch (e) {
    if (e.error_description) {
      res.status(400).json({
        error: `${e.error} : ${e.error_description}`,
      });
      return;
    }

    res.status(400).json({
      error: e.error,
    });
  }
});

function getService({ companyId, serviceId, serviceCode }) {
  return serviceReq
    .send('service.get', {
      companyId,
      id: serviceId,
      code: serviceCode,
    })
    .then(({ data }) => data)
    .catch(err => undefined);
}

async function updateOrderStatus(order) {
  logger.debug('updateOrderStatus', order);
  const shop = order.metadata.shopifyShop;
  const fulfillmentId = order.metadata.shopifyFulfillmentId;
  const integration = await getIntegration(shop);
  const accessToken = integration.metadata.accessToken;

  if (order.statusCode === 100) {
    const markFulfillmentOpen = (response) => {
      console.log('axios response', response); // eslint-disable-line
      if (response.status === 201) {
        orderReq
          .send('order.update', {
            id: order.id,
            companyId: order.companyId,
            metadata: { ...order.metadata, shopifyFulfillmentId: response.data.fulfillment.id },
          })
          .catch(err => logger.error('order markFulfillmentOpen err', err));

        // mark fullment as open
        const url = `https://${shop}/admin/orders/${order.extId}/fulfillments/${response.data.fulfillment.id}/open.json`;
        axios.post(url, {}, {
          headers: { 'X-Shopify-Access-Token': accessToken },
        });
      }
    };

    const service = await getService(order);

    const fulfillmentData = {
      fulfillment: {
        tracking_number: order.consignmentNo,
        tracking_url: `https://my.delyva.app/customer/strack?trackingNo=${order.consignmentNo}`,
        tracking_company: service.name,
      },
    };

    if (!fulfillmentId || fulfillmentId === '') {
      const url = `https://${shop}/admin/api/2021-07/orders/${order.extId}/fulfillments.json`;
      await axios
        .post(url, fulfillmentData, {
          headers: { 'X-Shopify-Access-Token': accessToken },
        })
        .then(response => markFulfillmentOpen(response))
        .catch((error) => {
          logger.error('shopify axios err 1', error);
          // TODO
        });
    } else {
      const url = `https://${shop}/admin/api/2021-07/orders/${order.extId}/fulfillments/${fulfillmentId}.json`;
      await axios
        .put(url, fulfillmentData, {
          headers: { 'X-Shopify-Access-Token': accessToken },
        })
        .then(response => markFulfillmentOpen(response))
        .catch((error) => {
          logger.error('shopify axios err 2', error);
          // TODO
        });
    }
  } else if (order.statusCode === 700 || order.statusCode === 750 || order.statusCode === 1000) {
    const url = `https://${shop}/admin/api/2021-07/orders/${order.extId}/fulfillments/${fulfillmentId}/complete.json`;
    axios
      .post(url, {}, {
        headers: { 'X-Shopify-Access-Token': accessToken },
      })
      .then((response) => {
        // DO NOTHING?
      })
      .catch((error) => {
        logger.error('shopify axios err 3', error);
        // TODO
      });
  }
}

router.get('/reload_status', token('shopify.reload_status'), async (req, res) => {
  const { charge_id } = req.query;
  const { companyId } = res.locals.user;

  try {
    const tx = await walletReq
      .send('wallet.tx.get', { companyId, ref: charge_id, ref2: 'shopify' })
      .then(({ data }) => {
        if (!Array.isArray(data) || data.length === 0) return false;
        return data[0];
      })
      .catch((err) => {
        logger.error('shopify reload_status get tx ERR', err);
        return false;
      });

    if (!tx) {
      res.status(400).json({ error: 'Invalid tx' });
      return;
    }

    logger.debug('shopify reload status tx', tx);

    const { ref3: shop } = tx;
    let chargeStatus = false;

    if (tx.status === 1) {
      res.json({
        charge: {
          id: charge_id,
          status: 'active',
        },
      });
      return;
    }

    if (tx.status !== 1 && tx.ref === charge_id) {
      const integration = await getIntegration(shop);
      const { accessToken } = integration.metadata;

      const charge = await axios
        .get(`https://${shop}/admin/api/2021-07/application_charges/${charge_id}.json`, {
          headers: { 'X-Shopify-Access-Token': accessToken },
        })
        .then(({ data }) => data.application_charge);

      if (!charge) {
        res.status(500).json({ error: 'Unable to read charge' });
        return;
      }

      logger.debug('charge status', { charge_id, shop }, charge);

      chargeStatus = charge.status;
      let creditBalance = 0;
      if (chargeStatus === 'active') {
        await walletReq
          .send('wallet.tx.update', {
            id: tx.id,
            companyId,
            status: 1,
          })
          .then(data => data.data);

        const customer = await getCustomer(companyId, integration.customerId);
        if (customer.error) {
          res.status(400).json({ error: customer.error });
          return;
        }
        creditBalance = customer.walletBalance;
      }

      res.json({
        charge: {
          id: charge.id,
          status: charge.status,
          creditBalance,
        },
      });
      return;
    }
  } catch (err) {
    logger.error(err);
    res.status(400).json(err);
  }
});

// router.post('/reload_exchange', token('shopify.exchange'), async (req, res) => {
//   const { shop } = req.body;
//   const { companyId } = res.locals.user;

//   const cacheKey = `shopify${shop}accessToken`;
//   let accessToken = await redis.get(cacheKey);

//   if (!accessToken) {
//     const integration = await getIntegration(companyId, shop);
//     if (integration.error) {
//       res.status(400).json({ error: integration.error });
//       return;
//     }

//     accessToken = integration.metadata.accessToken;
//     redis.setex(cacheKey, 300, accessToken); // cache 8 hrs
//   }

//   const shopData = await getShop(shop, accessToken);
//   const perUsd = shopData.currency !== 'USD' ? await getCurrencyExchange(shopData.currency) : 1;

//   res.json({
//     currency: shopData.currency,
//     perUsd,
//   });
// });

function getCustomerAccount(companyId, customerId) {
  logger.info(`Fetching customer account info customerId: ${customerId}...`);
  return walletReq
    .send('wallet.acc.customer', { companyId, customerId })
    .then(data => data.data)
    .catch(err => err);
}

// app subscription result
router.get('/reload', token('shopify.reload'), async (req, res) => {
  logger.debug('reload shopify', req.query);

  const { companyId } = res.locals.user;

  // price = always usd
  const { shop, amountUsd: price, amount: priceLocal } = req.query;

  if (Number(priceLocal) < 50) {
    res.status(400).json({ error: 'Invalid amount' });
    return;
  }

  const integration = await getIntegration(shop);

  if (integration.error) {
    res.status(400).json({ error: integration.error });
    return;
  }
  const { accessToken } = integration.metadata;
  const shopData = await getShop(shop, accessToken);

  const return_url = `https://${shop}/admin/apps/delyvax`;

  const url = `https://${shop}/admin/api/2021-07/application_charges.json`;
  const body = {
    application_charge: {
      name: `${priceLocal} ${shopData.currency} Credit`,
      price, // USD
      return_url,
      test: true,
    },
  };

  logger.debug('shopify reload', { body, url });

  const charge = await axios
    .post(url, body, {
      headers: { 'X-Shopify-Access-Token': integration.metadata.accessToken },
    })
    .then(({ data }) => data.application_charge)
    .catch((error) => {
      logger.error('Shopify Reload <application_charge> err', error);
      res.status(400).json('Shopify billing <application_charge> failed');
    });

  logger.debug('shopify charge', charge);

  if (!charge) {
    res.status(500).json({ error: 'Unable to create charge' });
    return;
  }

  const customerAccount = await getCustomerAccount(companyId, integration.customerId);
  logger.debug('customerAccount', customerAccount);

  const txData = {
    companyId,
    userId: integration.userId,
    accountNo: customerAccount.number,
    txType: 'fund',
    category: 'CTOPUP',
    txAmount: Number.parseFloat(priceLocal),
    pending: true,
    txDesc: `${priceLocal} ${shopData.currency} (${price} USD) Reload (via Shopify)`,
    txRef: String(charge.id),
    txRef2: 'shopify',
    txRef3: shop,
  };

  logger.debug('txData', txData);
  const pendingTx = await walletReq
    .send('wallet.tx.create', txData)
    .then(data => data.data)
    .catch((err) => {
      logger.error('shopify fund() ERR', err);
      return err;
    });

  logger.debug('shopify pendingTx', pendingTx);

  // TODO: check if tx inserted successfully before redirect
  res.redirect(charge.confirmation_url);
});

orderTrackingStream.on('order_tracking.update_w_extid', async (tracking) => {
  const order = await orderReq
    .send('order.get', {
      companyId: tracking.companyId,
      orderId: tracking.orderId,
    })
    .then(({ data }) => data)
    .catch(err => err);

  logger.debug('orderTrackingStream > get order', order);
  updateOrderStatus(order);
});

orderTrackingStream.on('order.processed', async (order) => {
  if (order.extIdType !== 'shopify-order-id' || !order.extId) return;
  if (!order.metadata || !order.metadata.shopifyShop) return;
  updateOrderStatus(order);
});


module.exports = router;

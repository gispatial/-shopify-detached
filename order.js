const logger = require('logger');
const axios = require('axios');
const requester = require('cote-requester');
const isEmpty = require('is-empty');
const Pn = require('awesome-phonenumber');

const orderReq = requester('md-orders', 'md-orders');
const getLocations = require('./helper/getLocations');

function checkIfEmpty(string) {
  return isEmpty(string) ? '' : string;
}

const validPhoneNumber = (value, countryCode = 'MY') => {
  if (!value || value === '') return value;
  const number = value.replace(/\D+/g, '');
  const validated = new Pn(number, countryCode).toJSON();

  if (validated.possible === false) {
    return false;
  }

  // input 60123456789 or +60123456789 > return with 60123456789
  return String(validated.number.e164).replace('+', '');
};

async function orderIsExists(companyId, shopifyFulfilmentId) {
  const orderExists = await orderReq
    .send('order.get', {
      companyId,
      extId: String(shopifyFulfilmentId),
      extIdType: 'shopify-fulfillment-id',
      resultSize: true,
    })
    .then(({ data }) => data)
    .catch((err) => {
      logger.error('shopify orderIsExists ERROR', err);
      return err;
    });

  logger.debug('func orderIsExists', orderExists, orderExists > 0);

  return Promise.resolve(orderExists > 0);
}

async function newOrder(req, res, integration) {
  const { customer, settings, companyId } = integration;
  const {
    'x-shopify-shop-domain': shop,
  } = req.headers;
  const orderId = req.body.order_id;

  // here because not all webhook topic need this
  if (integration.status !== 1) {
    logger.error('shopify webhook err - App inactive', integration.status);
    return res.status(200).json({ error: 'App is inactive' });
  }

  const { accessToken } = integration.metadata;

  const sorder = await axios
    .get(`https://${shop}/admin/orders/${orderId}.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    })
    .then(response => response.data.order)
    .catch((error) => {
      logger.error('order err', error.response.data);
      return false;
    });

  const originContact = {
    name: customer.name,
    phone: customer.phone || customer.mobile,
    email: customer.email,
    address1: customer.address1,
    address2: customer.address2,
    city: customer.city,
    state: customer.state,
    postcode: customer.postcode,
    country: customer.country,
  };

  const orders = [];
  const locations = await getLocations(shop, accessToken)
    .catch(() => []);

  let receiverPhone = null;
  if (Array.isArray(sorder.shipping_lines) && sorder.shipping_lines.length > 0) {
    sorder.serviceCode = sorder.shipping_lines[0].code;
    receiverPhone = sorder.shipping_lines[0].phone;
  }

  logger.debug('shopify sorder', JSON.stringify(sorder));

  const dest = sorder.shipping_address;

  let processOrder = false;
  if (settings.import_opt === 'auto' && sorder.serviceCode && sorder.serviceCode !== '') {
    processOrder = true;
  }

  // one order might need multiple shipment, split em - this is origin
  for (let i = 0; i < sorder.fulfillments.length; i += 1) {
    const fulfillments = sorder.fulfillments[i];
    const location = locations.find(l => l.id === fulfillments.location_id);
    const inventory = fulfillments.line_items // origin.waypoint.inventory
      .filter(item => item.requires_shipping === true)
      .map(item => ({
        name: item.name,
        type: String(settings.item_type || 'PARCEL'),
        price: {
          amount: item.price_set.shop_money.amount,
          currency: item.price_set.shop_money.currency_code,
        },
        weight: {
          value: item.grams,
          unit: 'g',
        },
        quantity: item.quantity,
        description: item.title,
      }));
    const order = {
      process: processOrder,
      companyId,
      customerId: customer.id,
      userId: customer.userId,
      source: 'shopify',
      serviceCode: sorder.serviceCode,
      note: `Order ${sorder.name}`,
      metadata: {
        integrationId: integration.id,
        shpFulfillmentId: fulfillments.id,
        shpLocationId: fulfillments.location_id,
        shpOrderNumber: sorder.order_number,
        shpShop: shop,
        shpOrderId: orderId,
      },
      extId: String(fulfillments.id),
      extIdType: 'shopify-fulfillment-id',
      origin: {
        inventory,
        contact: originContact,
      },
      destination: {
        inventory,
        contact: {
          name: [dest.first_name, dest.last_name].join(' '),
          address1: dest.address1,
          address2: checkIfEmpty(dest.address2),
          city: checkIfEmpty(dest.city),
          state: checkIfEmpty(dest.state),
          country: dest.country_code,
          postcode: dest.zip,
          phone: receiverPhone,
        },
        scheduledAt: 'now', // TODO: ikut settings
      },
    };

    if (dest.latitude && dest.longitude) {
      order.destination.contact.coord = {
        lat: String(dest.latitude),
        lon: String(dest.longitude),
      };
    }

    if (location) {
      logger.debug('shopify location', location);
      order.origin.contact = {
        name: location.name || customer.name,
        email: customer.email,
        phone: validPhoneNumber(location.phone, location.country)
        || validPhoneNumber(customer.mobile, location.country)
        || validPhoneNumber(customer.phone, location.country),
        mobile: customer.mobile || customer.phone,
        address1: location.address1,
        address2: checkIfEmpty(location.address2),
        city: checkIfEmpty(location.city),
        state: checkIfEmpty(location.state),
        postcode: checkIfEmpty(location.postcode),
        country: location.country,
      };
    }

    orders.push(order);
  }

  logger.debug('shopify new orders', JSON.stringify(orders));

  for (let i = 0; i < orders.length; i += 1) {
    const order = orders[i];
    logger.debug('shopify create order, odr.extId:', order.extId);
    orderIsExists(companyId, order.extId)
      .then((exists) => {
        if (!exists) {
          logger.debug('shopify create order', JSON.stringify(order));
          orderReq.send('order.create', order)
            .then(({ data }) => {
              logger.debug('shopify create order RESULT', data);
            })
            .catch((err) => {
              logger.error('shopify create order ERROR', err);
            });
        } else {
          logger.debug('shopify create order', `extId ${order.extId} alrady exists`);
        }
      })
      .catch(err => logger.error('loop orderIsExists ERR', err));
  }

  return res.sendStatus(200);
}

module.exports = { create: newOrder };

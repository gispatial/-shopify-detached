require("dotenv").config();
const webpack = require('webpack');

const apiKey = JSON.stringify('c93216654ef4eeb69978c5bd0b5b75a0');

module.exports = {
  basePath: '/v1.0/shopify/app',
  webpack: (config) => {
    const env = { API_KEY: apiKey };
    config.plugins.push(new webpack.DefinePlugin(env));
    return config;
  },
};
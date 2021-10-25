import React from 'react';
import App from 'next/app';
import Head from 'next/head';
import { Provider, Loading } from '@shopify/app-bridge-react';
import { AppProvider } from '@shopify/polaris';
import '@shopify/polaris/dist/styles.css';
import translations from '@shopify/polaris/locales/en.json';

class MyApp extends App {
  render() {
    const { Component, pageProps } = this.props;
    const config = {
      apiKey: API_KEY,
      forceRedirect: false,
    };

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const shop = this.props.router.query.shop || params.get('shop');
      config.shopOrigin = `${shop}/admin`;
      config.host = Buffer.from(config.shopOrigin).toString("base64");
      return (
          <React.Fragment>
          <Head>
            <title>Delyva</title>
            <meta charSet="utf-8" />
          </Head>
          <AppProvider i18n={translations}>
            <Provider config={config}>
              <Loading />
              <Component {...pageProps} />
            </Provider>
          </AppProvider>
        </React.Fragment>
        );
    }

    console.log('NOPE NOPE!');

    return (
      <React.Fragment>
        <Head>
          <title>Delyva</title>
          <meta charSet="utf-8" />
        </Head>
        <AppProvider i18n={translations}>
          <Component {...pageProps} />
        </AppProvider>
      </React.Fragment>
    );
  }
}

export default MyApp;
import React, { useState } from 'react';
import axios from 'axios';
import {
  Card,
  FormLayout,
  Layout,
  Page,
  OptionList,
  TextField,
  ChoiceList,
  Select,
  PageActions,
  Toast,
  Frame,
  SkeletonBodyText,
  Banner,
  // Modal,
  Button,
  Stack,
  TextContainer,
  Heading,
} from '@shopify/polaris';

class AnnotatedLayout extends React.Component {
  state = {
    companyId: '',
    needSetup: false,
    setupKey: '',
    integrationMode: 'manual',
    pickupDay: '0',
    pickupHour: '10:00',
    itemType: 'PARCEL',
    isSubmittingForm: false,
    pickupMode: 'default',
    pickupCountry: 'MY',
    pickupAddress: {},
    pickupAddress1: '',
    pickupAddress2: '',
    pickupEmail: '',
    pickupMobile: '',
    pickupPostcode: '',
    pickupCity: '',
    pickupState: '',
    pickupName: '',
    isSubmitting: false,
    setupError: false,
    toastIsError: false,
    toasMessage: false,
    pageIsLoading: true,
    creditBalance: 0,
    jwtExpireAt: 0,
    accessToken: null,
    refreshToken: null,
    integrationId: null,
    initializing: true,
    apiEndpoint: 'https://api.delyva.app',
    criticalMessage: false,
    custId: null,
    shop: '',
    listOfServiceProviders: [],
    selectedServicesSaved: [],
    selectedServices: [],
    listOfItemTypes: [],
    subsStatus: 'inactive',
    topupAmount: '50',
    topupAmountUsd: 0,
    topupLabelAmount: "Amount",
    topupError: false,
    showReload: false,
    currency: 'MYR',
    perusd: 0.24,
    checkingReloadStatus: false,
  };

  renderSaveButton() {
    if (this.state.isSubmittingForm) {
      return (
        <PageActions
          primaryAction={{
            content: 'Save',
            onClick: this.saveSettings,
            loading: true,
          }}
        />
      )
    }

    return (
      <PageActions
        primaryAction={{
          content: 'Save',
          onClick: this.saveSettings,
        }}
      />
    )
  }

  attachApp = () => {
    const {
      apiEndpoint,
      integrationId,
      shop,
      setupKey,
    } = this.state;
    this.setState({
      isSubmitting: true,
      setupError: false,
    });

    const customerId = setupKey.split('.')[0];
    const accessToken = setupKey.split(`${customerId}.`)[1];

    const ax = axios.create({
      baseURL: apiEndpoint,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      }
    });

    return ax
      .post('/v1.0/shopify/attach', {
        customerId,
        integrationId,
        shop,
      })
      .then(async ({ data: response }) => {
        const { customer, jwt, integrationId, companyId } = response.data;

        // console.log('response.data', response.data);

        const perUsd = Number.parseFloat(response.data.perUsd).toFixed(2);
        
        let updateState = {
          companyId,
          initializing: false,
          needSetup: false,
          pageIsLoading: true,
          custId: String(customer.id),
          accessToken: jwt.accessToken,
          refreshToken: jwt.refreshToken,
          jwtExpireAt: Number(jwt.expireIn) + Math.floor(Date.now() / 1000) - 60,
          creditBalance: String(customer.walletBalance),
          custName: customer.name,
          custEmail: customer.email,
          integrationId: integrationId,
          currency: response.data.currency,
          perUsd,
          topupLabelAmount: `Amount (${response.data.currency})`,
          topupAmountUsd: this.state.topupAmount * perUsd,
        };

        this.showMessage(`Success! Hello ${customer.name}!`, false);
        console.log('attach updateState', updateState);
        this.setState(updateState);
        this.populateItemType(companyId);
        this.populateServiceProvider();
        await this.getSettings();
        this.setState({ pageIsLoading: false });
      })
      .catch((err) => {
        if (err.response && err.response.status === 401) {
          err.message = 'Token invalid or expired, please refresh the page, and copy the token again';
        }
        this.setState({
          setupError: err.message,
          isSubmitting: false
        })
      })
  }

  handleSubmit = () => {
    this.setState({
      discount: this.state.discount,
    });
    console.log('submission', this.state);
  };

  handleChange = (field) => {
    return (value) => {
      const state = { [field]: value };
      if (field === 'topupAmount') {
        state.topupAmountUsd = Number.parseFloat(value * this.state.perUsd).toFixed(2);
      }
      return this.setState(state);
    }
  };

  getToken = async () => {
    const { apiEndpoint, jwtExpireAt } = this.state;
    const now = Math.floor(Date.now() / 1000);

    if (jwtExpireAt > now) return this.state.accessToken;
    if (this.state.jwtExpireAt === 0 || !this.state.accessToken || !this.state.refreshToken) {
      this.showMessage('Failed to refresh JWT token', true);
      return;
    };

    const ax = axios.create({
      baseURL: apiEndpoint,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.state.accessToken}`,
      }
    });

    return ax
      .post('/v1.0/auth/refreshToken', {
        refreshToken: this.state.refreshToken
      })
      .then(response => {
        const { accessToken, expireIn } = response.data.data;
        this.setState({
          accessToken,
          jwtExpireAt: Number(expireIn) + Math.floor(Date.now() / 1000) - 60,
        });
        return accessToken;
      })
      .catch((err) => {
        this.showMessage(err.message, true);
      })
  }

  doReloadCredit = async () => {
    this.setState({ pageIsLoading: true });
    const { apiEndpoint, shop, topupAmountUsd, topupAmount } = this.state;
    const accessToken = await this.getToken();
    window.top.location = `${apiEndpoint}/v1.0/shopify/reload?jwt=${accessToken}&shop=${shop}&amountUsd=${topupAmountUsd}&amount=${topupAmount}`;
  }

  checkReloadStatus = async (charge_id) => {
    const { apiEndpoint } = this.state;
    this.setState({ checkingReloadStatus: true });
    const accessToken = await this.getToken();
    axios.get(`${apiEndpoint}/v1.0/shopify/reload_status?jwt=${accessToken}&charge_id=${charge_id}`)
      .then(({ data }) => {
        const { charge } = data;
        console.log('charge', charge);

        if (charge.status === 'active') {
          this.showMessage(`Reload success!`, false);
          this.setState({
            creditBalance: String(charge.creditBalance),
             checkingReloadStatus: false,
          });
        } else if (charge.status) {
          this.showMessage(`Reload failed! ${charge.status}`, false);
        }
      })
      .catch(err => {
        this.setState({ checkingReloadStatus: false });
        this.showMessage(`Reload failed! Please reload this page. ${err.message}`, false);
      });
  }

  populateItemType = async (companyId) => {
    const { apiEndpoint } = this.state;
    const accessToken = await this.getToken();

    return axios
      .get(`${apiEndpoint}/v1.0/service/itemTypes?companyId=${companyId}`)
      .then(response => {
        const { data: itemTypes } = response.data;

        this.setState({
          listOfItemTypes: itemTypes
            .map(sp => ({ value: sp.name, label: sp.description }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        })
        return Promise.resolve(1);
      })
      .catch(err => {
        this.setState({ criticalMessage: err.message });
        return Promise.reject(err);
      })
  }

  populateServiceProvider = async () => {
    const { apiEndpoint } = this.state;
    const accessToken = await this.getToken();

    return axios
      .get(`${apiEndpoint}/v1.0/service/serviceCompany/codes?customerId=${this.state.custId}`,{
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        }
      })
      .then(response => {
        const { data: serviceProviders } = response.data;

        this.setState({
          listOfServiceProviders: serviceProviders
            .map(sp => ({ value: sp.id, label: sp.name }))
            .sort((a, b) => a.label.localeCompare(b.label)),
          selectedServices: this.state.selectedServicesSaved,
        })
        return Promise.resolve(1);
      })
      .catch(err => {
        this.setState({ criticalMessage: err.message });
        return Promise.reject(err);
      })
  }

  getSettings = async () => {
    const { apiEndpoint } = this.state;
    const accessToken = await this.getToken();

    return axios
      .get(`${apiEndpoint}/v1.0/integration/${this.state.integrationId}`,{
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        }
      })
      .then(response => {
        const { settings: setting } = response.data.data;
        if (!setting) return Promise.resolve(1);
        if (!setting.pickupAddress) {
          setting.pickupAddress = {};
        }

        this.setState({
          pickupDay: setting.pickup_date || this.state.pickupDay,
          pickupHour: setting.pickup_time || this.state.pickupHour,
          integrationMode: setting.import_opt || this.state.integrationMode,
          itemType: setting.item_type || this.state.itemType,
        })
        return Promise.resolve(1);
      })
      .catch(err => {
        this.setState({ criticalMessage: err.message });
        return Promise.reject(err);
      })
  }

  saveSettings = async () => {
    const { apiEndpoint } = this.state;
    this.setState({
      isSubmittingForm: true
    });

    const accessToken = await this.getToken();

    axios.patch(`${apiEndpoint}/v1.0/integration/${this.state.integrationId}`, {
      customerId: this.state.custId,
      settings: {
        import_opt: this.state.integrationMode,
        pickup_date: this.state.pickupDay,
        pickup_time: this.state.pickupHour,
        item_type: this.state.itemType,
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      }
    })
    .then((response) => {
      this.showMessage(`Settings saved!`, false);
      this.setState({
        isSubmittingForm: false
      });
    })
    .catch((err) => {
      this.showMessage(err.message, true);
      this.setState({
        isSubmittingForm: false
      });
    })

    if (this.state.selectedServicesSaved.join('') !== this.state.selectedServices.join('')) {
      axios.patch(`${apiEndpoint}/v1.0/customer`, {
        id: this.state.custId,
        selectedServices: this.state.selectedServices,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        }
      })
      .then((response) => {
        this.state.selectedServicesSaved = this.state.selectedServices;
      })
      .catch((err) => {
        this.showMessage(err.message, true);
      })
    }
  }

  showMessage(toastMessage, toastIsError = false) {
    this.setState({ toastMessage, toastIsError });
  }

  showReload = () => {
    this.setState({ showReload: true });
  }

  hideReload = () => {
    this.setState({ showReload: false });
  }

  hideError() {
    return () => this.setState({ toastMessage: false });
  }

  async initReload() {
    
  }

  async initDelyvaNow() {
    const { apiEndpoint } = this.state;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : {};

    this.setState({
      initializing: false,
      shop: typeof window !== 'undefined' ? params.get('shop') : '',
    });

    let axiosReq = axios.get(`${apiEndpoint}/v1.0/shopify/init?${params.toString()}`);

    if (this.state.accessToken !== null) {
      const accessToken = await this.getToken();
      axiosReq = axios.get(`${apiEndpoint}/v1.0/shopify/init?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        }
      });
    }

    // Initial app setting
    return axiosReq.then(async (response) => {
      const { data } = response.data;
      if (response.status == 200) {
        const { shop, integrationId, customer, jwt, status, locations } = data;

        if (!status) {
          this.setState({ criticalMessage: 'Unable to retrieve app status' });
          return Promise.resolve(1);
        }

        // installed, but incomplete
        if (integrationId && status === 2) {
          const installUrl = `${apiEndpoint}/v1.0/shopify/install?${params.toString()}`;
          window.location.href = installUrl;
          return;
        }

        // check if we're in shopify iframe
        if (typeof window !== 'undefined' && window.self === window.top) {
          window.top.location = `https://${params.get('shop')}/admin/apps/${API_KEY}${window.location.pathname}${window.location.search || ''}`;
          return;
        }

        // installed but not attached to customer
        if (integrationId && !customer) {
          this.setState({
            shop,
            integrationId,
            needSetup: true,
          });
          return Promise.resolve(1);
        }

        // if (data.subsStatus !== 'active') {
        //   Router.push('/no_access');
        //   return Promise.resolve(1);
        // }

        const { id, walletBalance, email, name: custName } = customer;
        const { accessToken, refreshToken, expireIn } = jwt;

        // TODO: App is installed, but not linked to DelyvaNow user >  show setup page
        if (!data.jwt) {
          this.setState({ criticalMessage: 'Failed to authenticate with Delyva server.' });
          return Promise.resolve(1);
        }

        const perUsd = Number.parseFloat(data.perUsd).toFixed(2);

        let updateState = {
          companyId: data.companyId,
          custId: String(id),
          accessToken,
          refreshToken,
          jwtExpireAt: Number(expireIn) + Math.floor(Date.now() / 1000) - 60,
          creditBalance: String(walletBalance),
          custName,
          custEmail: email,
          integrationId: integrationId,
          selectedServicesSaved: customer.selectedServices || [],
          subsStatus: data.subsStatus,
          currency: data.currency,
          perUsd,
          topupLabelAmount: `Amount (${data.currency})`,
          topupAmountUsd: this.state.topupAmount * perUsd,
        };

        console.log('updateState', updateState);

        this.setState(updateState);
        this.populateItemType(data.companyId);
        this.populateServiceProvider();
        await this.getSettings();
        this.setState({ pageIsLoading: false });

        const charge_id = params.get('charge_id');
        if (charge_id) {
          this.checkReloadStatus(charge_id);
        }
        
        return Promise.resolve(1);
      } else {
        this.setState({ criticalMessage: 'Unknown error' });
        return Promise.resolve(1);
      }
    })
    .catch(err => {
      if (err.response) {
        if (err.response.status === 404 || err.response.status === 403 && typeof window !== 'undefined') {
          window.location.href = `${apiEndpoint}/v1.0/shopify/install?${params.toString()}`;
          return;
        }

        // if (typeof window !== 'undefined') {
        //   localStorage.setItem('dxShopifyShop', params.get('shop'));
        // }

        if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
          err.message = err.response.data.error.message;
        }
      }

      this.setState({ criticalMessage: err.message || err });
      return Promise.resolve(1);
    })
  }

  renderErrorBanner() {
    return <Frame>
        <Page><Banner
          title="Failed to load Delyva"
          status="critical"
        >
      <p>
        {this.state.criticalMessage}
      </p>
    </Banner></Page></Frame>;
  }

  render() {
    const { integrationMode, toastMessage, custId, creditBalance } = this.state;

    const ToastMessage = toastMessage ? (
      <Toast content={this.state.toastMessage} error={this.state.toastIsError} onDismiss={this.hideError()}/>
    ) : null;

    const pickUpDay = [
      {label: 'Same Day', value: '0'},
      {label: '+1 Business Day', value: '1'},
      {label: '+2 Business Day', value: '2'},
      {label: '+3 Business Day', value: '3'},
    ];

    const pickUpHour = [
      {label: '09:00', value: '09:00'},
      {label: '09:30', value: '09:30'},
      {label: '10:00', value: '10:00'},
      {label: '10:30', value: '10:30'},
      {label: '11:00', value: '11:00'},
      {label: '11:30', value: '11:30'},
      {label: '12:00', value: '12:00'},
      {label: '12:30', value: '12:30'},
      {label: '13:00', value: '13:00'},
      {label: '13:30', value: '13:30'},
      {label: '14:00', value: '14:00'},
      {label: '14:30', value: '14:30'},
      {label: '15:00', value: '15:00'},
      {label: '15:30', value: '15:30'},
      {label: '16:00', value: '16:00'},
      {label: '16:30', value: '16:30'},
      {label: '17:00', value: '17:00'},
      {label: '17:30', value: '17:30'},
      {label: '18:00', value: '18:00'},
      {label: '18:30', value: '18:30'},
      {label: '19:00', value: '19:00'},
      {label: '19:30', value: '19:30'},
      {label: '20:00', value: '20:00'},
    ];

    const RenderSkeletonSettings = () => {
      return <Frame><Page
          title="Settings"
        >{ToastMessage}<Layout>
          <Layout.AnnotatedSection
              title="Account details"
            >
              <Card sectioned>
                <FormLayout>
                  <SkeletonBodyText />
                </FormLayout>
              </Card>
            </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
              title="Shipment Settings"
              description=""
            >
              <Card sectioned>
                <FormLayout>
                  <SkeletonBodyText />

                  <FormLayout.Group>
                  <SkeletonBodyText />
                      <SkeletonBodyText />
                </FormLayout.Group>

               <SkeletonBodyText />

                </FormLayout>
              </Card>
            </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
              title="Service Provider"
              description="Select courier service that you would like to use. Select none for all."
            >
              <Card sectioned>
                <FormLayout>
                  <SkeletonBodyText />
                  <SkeletonBodyText />
                </FormLayout>
              </Card>
            </Layout.AnnotatedSection>
        </Layout></Page>
      </Frame>;
    };

    const RenderReload = () => {
      return <Frame>
      <Page
        narrowWidth
        breadcrumbs={[{content: 'Settings', onAction: this.hideReload}]}
      >
        <Card title="Reload Credit">
        <Card.Section>
          <Stack vertical={true}>
            <Stack vertical>
                      <Stack.Item fill>
                        <TextField
                          type="number"
                          label={this.state.topupLabelAmount}
                          value={this.state.topupAmount}
                          onChange={this.handleChange('topupAmount')}
                          min="50"
                          max="5000"
                          error={this.state.topupAmount < 50 || this.state.topupAmount > 5000 ? 'Amount must be between 50 and 5000' : false}
                        />
                      </Stack.Item>
                      <Stack.Item fill>
          <p><strong>Exchange rate:</strong> 1 {this.state.currency} = {this.state.perUsd} USD</p>
          <p><strong>Reload amount (USD):</strong> { this.state.topupAmountUsd }</p>
          </Stack.Item>

                    </Stack>
          </Stack>

          </Card.Section>
          <Card.Section>
<p>
  Amount will be credited into your account when payment is approved.
</p>
<p>
  By continuing, you acknowledge to accept Delyva credit <a target="_blank" href='https://delyva.com/my/terms'>Terms of Use</a>
</p>
  </Card.Section>
        </Card>
        <PageActions
        primaryAction={{
          disabled: Number(this.state.topupAmount) < 50 || Number(this.state.topupAmount) > 5000,
          content: 'Continue',
          onClick: this.doReloadCredit,
          loading: this.state.pageIsLoading
        }}
      />
      </Page>
    </Frame>;
    }

    const RenderSetup = (props) => {
        return <Page title="Connect to Delyva">
        <Layout><Layout.AnnotatedSection
              title="Setup"
              description="Log-in to DelyvaX customer portal, and copy the one time identity token."
            >
            <Card sectioned>
              <FormLayout>
                <TextField
                  type="text"
                  label="One time identity token"
                  onChange={this.handleChange('setupKey')}
                  value={this.state.setupKey}
                  disabled={this.state.isSubmitting}
                  error={this.state.setupError}
                  /*autoFocus="autoFocus"*/
                />
              </FormLayout>
            </Card>
            <PageActions
                  primaryAction={{
                    content: 'Submit',
                    onClick: this.attachApp,
                    loading: this.state.isSubmitting,
                  }}
                />
          </Layout.AnnotatedSection></Layout></Page>;
    };

    const RenderPage = () => {
      return this.state.pageIsLoading ? RenderSkeletonSettings() : RenderSettings();
    };

    const RenderSettings = (props) => {
      return <Frame>
      <Page
          title="Settings"
        >
        {ToastMessage}
        <Layout>
          <Layout.AnnotatedSection
              title="Account details"
            >
              <Card sectioned>
                <FormLayout>
                  <TextField type="text" label="Customer Name" value={this.state.custName} disabled />
                  <FormLayout.Group>
                    <TextField type="text" label="Credit Balance" value={creditBalance} disabled />
                    <TextField type="text" label="Customer ID" value={custId} disabled />
                  </FormLayout.Group>
                  
                <Button onClick={this.showReload} loading={this.state.checkingReloadStatus}>Reload Credit</Button>

                </FormLayout>
              </Card>
              
            </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
              title="Shipment"
              description="How should this app handle new order"
            >
              <Card sectioned>
                <FormLayout>
                  <ChoiceList
                    title='New order action'
                    choices={[
                      {label: 'Process immediately', value: 'auto'},
                      {label: 'Save as draft', value: 'manual' },
                    ]}
                    selected={integrationMode}
                    onChange={this.handleChange('integrationMode')}
                  />

                  <FormLayout.Group>
                  <Select
                        label="Processing day"
                        options={pickUpDay}
                        onChange={this.handleChange('pickupDay')}
                        value={this.state.pickupDay}
                      />
                      <Select
                      label="Processing time"
                      options={pickUpHour}
                      onChange={this.handleChange('pickupHour')}
                      value={this.state.pickupHour}
                    />
                </FormLayout.Group>

                <Select
                  label={'Default item type'}
                  options={this.state.listOfItemTypes}
                  onChange={this.handleChange('itemType')}
                  value={this.state.itemType}
                />

                </FormLayout>
              </Card>
            </Layout.AnnotatedSection>
        </Layout>
        <p><br /></p>
        {this.renderSaveButton()}
      </Page>
      </Frame>
    }

    if (this.state.showReload === true) {
      return RenderReload();
    } else if (this.state.needSetup) {
      return RenderSetup();
    } else {
      if (this.state.initializing) {
        this.initDelyvaNow();
      } else if (this.state.criticalMessage !== false) {
        return this.renderErrorBanner();
      }
      return RenderPage(); 
    }
  }
}

export default AnnotatedLayout;
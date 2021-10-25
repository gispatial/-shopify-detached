import React from 'react'
import Router from 'next/router'

export default class DelyvaLayout extends React.Component {
  // TODO: check if authenticated
  componentDidMount() {
    const {pathname} = Router
    if(pathname == '/' ){
       Router.push('/settings')
    }
  }
  render () {
    return (
      <div>
        {this.props.children}
      </div>
    )
  }
}
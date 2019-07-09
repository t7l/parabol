import PropTypes from 'prop-types'
import React from 'react'
import {withRouter} from 'react-router-dom'
import {PROFILE, ORGANIZATIONS, NOTIFICATIONS} from 'universal/utils/constants'
import DashHeaderTitle from 'universal/components/DashHeaderTitle'
import Icon from 'universal/components/Icon'
import {DASH_SIDEBAR} from 'universal/components/Dashboard/DashSidebar'
import useBreakpoint from 'universal/hooks/useBreakpoint'
import styled from 'react-emotion'
import {PALETTE} from 'universal/styles/paletteV2'

const heading = {
  [PROFILE]: {
    label: 'Profile'
  },
  [ORGANIZATIONS]: {
    label: 'Organizations'
  },
  [NOTIFICATIONS]: {
    label: 'Notifications'
  }
}

const Root = styled('div')({
  alignItems: 'center',
  display: 'flex',
  width: '100%'
})

const Title = styled(DashHeaderTitle)({
  margin: 0,
  padding: 0
})

const MenuIcon = styled(Icon)({
  color: PALETTE.TEXT_LIGHT,
  cursor: 'pointer',
  display: 'block',
  marginRight: 16,
  userSelect: 'none'
})

const SettingsHeader = (props) => {
  const {location} = props
  const [area] = location.pathname.slice(4).split('/')
  const isDesktop = useBreakpoint(DASH_SIDEBAR.BREAKPOINT)
  const handleOnClick = () => console.log('menu icon click')
  return (
    <Root>
      {!isDesktop && <MenuIcon onClick={handleOnClick}>menu</MenuIcon>}
      <Title>{heading[area].label}</Title>
    </Root>
  )
}

SettingsHeader.propTypes = {
  location: PropTypes.object
}

export default withRouter(SettingsHeader)

import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import { withTracker } from 'meteor/react-meteor-data';
import { Session } from 'meteor/session';
import { withModalMounter } from '/imports/ui/components/modal/service';
import { injectIntl, defineMessages } from 'react-intl';
import _ from 'lodash';
import Breakouts from '/imports/api/breakouts';
import AppService from '/imports/ui/components/app/service';
import { notify } from '/imports/ui/services/notification';
import getFromUserSettings from '/imports/ui/services/users-settings';
import VideoPreviewContainer from '/imports/ui/components/video-preview/container';
import lockContextContainer from '/imports/ui/components/lock-viewers/context/container';
import {
  joinMicrophone,
  joinListenOnly,
  didUserSelectedMicrophone,
  didUserSelectedListenOnly,
} from '/imports/ui/components/audio/audio-modal/service';

import Service from './service';
import AudioModalContainer from './audio-modal/container';
import Settings from '/imports/ui/services/settings';

const APP_CONFIG = Meteor.settings.public.app;
const KURENTO_CONFIG = Meteor.settings.public.kurento;

const intlMessages = defineMessages({
  joinedAudio: {
    id: 'app.audioManager.joinedAudio',
    description: 'Joined audio toast message',
  },
  joinedEcho: {
    id: 'app.audioManager.joinedEcho',
    description: 'Joined echo test toast message',
  },
  leftAudio: {
    id: 'app.audioManager.leftAudio',
    description: 'Left audio toast message',
  },
  reconnectingAudio: {
    id: 'app.audioManager.reconnectingAudio',
    description: 'Reconnecting audio toast message',
  },
  genericError: {
    id: 'app.audioManager.genericError',
    description: 'Generic error message',
  },
  connectionError: {
    id: 'app.audioManager.connectionError',
    description: 'Connection error message',
  },
  requestTimeout: {
    id: 'app.audioManager.requestTimeout',
    description: 'Request timeout error message',
  },
  invalidTarget: {
    id: 'app.audioManager.invalidTarget',
    description: 'Invalid target error message',
  },
  mediaError: {
    id: 'app.audioManager.mediaError',
    description: 'Media error message',
  },
  BrowserNotSupported: {
    id: 'app.audioNotification.audioFailedError1003',
    description: 'browser not supported error messsage',
  },
  reconectingAsListener: {
    id: 'app.audioNotificaion.reconnectingAsListenOnly',
    description: 'ice negociation error messsage',
  },
});

class AudioContainer extends PureComponent {
  constructor(props) {
    super(props);

    this.init = props.init.bind(this);
  }

  componentDidMount() {
    const { meetingIsBreakout } = this.props;

    this.init();

    if (meetingIsBreakout && !Service.isUsingAudio()) {
      this.joinAudio();
    }
  }

  componentDidUpdate(prevProps) {
    if (this.userIsReturningFromBreakoutRoom(prevProps)) {
      this.joinAudio();
    }
  }

  /**
   * Helper function to determine wheter user is returning from breakout room
   * to main room.
   * @param  {[Object} prevProps prevProps param from componentDidUpdate
   * @return {boolean}           True if user is returning from breakout room
   *                             to main room. False, otherwise.
   */
  userIsReturningFromBreakoutRoom(prevProps) {
    const { hasBreakoutRooms } = this.props;
    const { hasBreakoutRooms: hadBreakoutRooms } = prevProps;
    return hadBreakoutRooms && !hasBreakoutRooms;
  }

  /**
   * Helper function that join (or not) user in audio. If user previously
   * selected microphone, it will automatically join mic (without audio modal).
   * If user previously selected listen only option in audio modal, then it will
   * automatically join listen only.
   */
  joinAudio() {
    if (Service.isConnected()) return;

    const {
      userSelectedMicrophone,
      userSelectedListenOnly,
    } = this.props;

    if (userSelectedMicrophone) {
      joinMicrophone(true);
      return;
    }

    if (userSelectedListenOnly) joinListenOnly();
  }

  render() {
    return null;
  }
}

let didMountAutoJoin = false;

const webRtcError = _.range(1001, 1011)
  .reduce((acc, value) => ({
    ...acc,
    [value]: { id: `app.audioNotification.audioFailedError${value}` },
  }), {});

const messages = {
  info: {
    JOINED_AUDIO: intlMessages.joinedAudio,
    JOINED_ECHO: intlMessages.joinedEcho,
    LEFT_AUDIO: intlMessages.leftAudio,
    RECONNECTING_AUDIO: intlMessages.reconnectingAudio,
  },
  error: {
    GENERIC_ERROR: intlMessages.genericError,
    CONNECTION_ERROR: intlMessages.connectionError,
    REQUEST_TIMEOUT: intlMessages.requestTimeout,
    INVALID_TARGET: intlMessages.invalidTarget,
    MEDIA_ERROR: intlMessages.mediaError,
    WEBRTC_NOT_SUPPORTED: intlMessages.BrowserNotSupported,
    ...webRtcError,
  },
};

export default lockContextContainer(withModalMounter(injectIntl(withTracker(({ mountModal, intl, userLocks }) => {
  const { microphoneConstraints } = Settings.application;
  const autoJoin = getFromUserSettings('bbb_auto_join_audio', APP_CONFIG.autoJoin);
  const enableVideo = getFromUserSettings('bbb_enable_video', KURENTO_CONFIG.enableVideo);
  const autoShareWebcam = getFromUserSettings('bbb_auto_share_webcam', KURENTO_CONFIG.autoShareWebcam);
  const { userWebcam, userMic } = userLocks;

  const userSelectedMicrophone = didUserSelectedMicrophone();
  const userSelectedListenOnly = didUserSelectedListenOnly();
  const meetingIsBreakout = AppService.meetingIsBreakout();
  const hasBreakoutRooms = AppService.getBreakoutRooms().length > 0;
  const openAudioModal = () => new Promise((resolve) => {
    mountModal(<AudioModalContainer resolve={resolve} />);
  });

  const openVideoPreviewModal = () => new Promise((resolve) => {
    if (userWebcam) return resolve();
    mountModal(<VideoPreviewContainer resolve={resolve} />);
  });

  if (Service.isConnected() && !Service.isListenOnly()) {
    Service.updateAudioConstraints(microphoneConstraints);

    if (userMic && !Service.isMuted()) {
      Service.toggleMuteMicrophone();
      notify(intl.formatMessage(intlMessages.reconectingAsListener), 'info', 'volume_level_2');
    }
  }

  Breakouts.find().observeChanges({
    removed() {
      // if the user joined a breakout room, the main room's audio was
      // programmatically dropped to avoid interference. On breakout end,
      // offer to rejoin main room audio only if the user is not in audio already
      if (Service.isUsingAudio()
        || userSelectedMicrophone
        || userSelectedListenOnly) {
        if (enableVideo && autoShareWebcam) {
          openVideoPreviewModal();
        }

        return;
      }
      setTimeout(() => openAudioModal().then(() => {
         if (enableVideo && autoShareWebcam) {
           openVideoPreviewModal();
          }
        }), 0);
    },
  });

  return {
    hasBreakoutRooms,
    meetingIsBreakout,
    userSelectedMicrophone,
    userSelectedListenOnly,
    init: () => {
      Service.init(messages, intl);
      const enableVideo = getFromUserSettings('bbb_enable_video', KURENTO_CONFIG.enableVideo);
      const autoShareWebcam = getFromUserSettings('bbb_auto_share_webcam', KURENTO_CONFIG.autoShareWebcam);
      if ((!autoJoin || didMountAutoJoin)) {
        if (enableVideo && autoShareWebcam) {
          openVideoPreviewModal();
        }
        return;
      }
      Session.set('audioModalIsOpen', true);
      if (enableVideo && autoShareWebcam) {
        openAudioModal().then(() => { openVideoPreviewModal(); didMountAutoJoin = true; });
      } else if (!(
        userSelectedMicrophone
        && userSelectedListenOnly
        && meetingIsBreakout)) {
        openAudioModal();
        didMountAutoJoin = true;
      }
    },
  };
})(AudioContainer))));

AudioContainer.propTypes = {
  hasBreakoutRooms: PropTypes.bool.isRequired,
  meetingIsBreakout: PropTypes.bool.isRequired,
  userSelectedListenOnly: PropTypes.bool.isRequired,
  userSelectedMicrophone: PropTypes.bool.isRequired,
};

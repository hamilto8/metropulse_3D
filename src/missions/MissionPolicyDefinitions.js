export const MISSION_WEATHER_POLICY_IDS = Object.freeze({
  STANDARD_ROAD: 'STANDARD_ROAD',
  EMERGENCY_RESPONSE: 'EMERGENCY_RESPONSE',
  DRY_COMPETITION: 'DRY_COMPETITION',
  SIGHTSEEING: 'SIGHTSEEING',
  ALL_WEATHER: 'ALL_WEATHER'
});

const roadAdaptation = Object.freeze({
  disposition: 'ADAPTED',
  reason: 'Wet roads reduce grip, so dispatch extends the deadline and hazard premium.',
  timeLimitMultiplier: 1.2,
  rewardMultiplier: 1.1
});

export const MISSION_WEATHER_POLICIES = Object.freeze({
  [MISSION_WEATHER_POLICY_IDS.STANDARD_ROAD]: Object.freeze({
    defaultDisposition: 'ALLOWED',
    modes: Object.freeze({
      rain: roadAdaptation,
      thunderstorm: Object.freeze({
        disposition: 'DELAYED',
        reason: 'Dispatch has delayed this road mission until the thunderstorm passes.'
      })
    })
  }),
  [MISSION_WEATHER_POLICY_IDS.EMERGENCY_RESPONSE]: Object.freeze({
    defaultDisposition: 'ALLOWED',
    modes: Object.freeze({
      rain: roadAdaptation,
      thunderstorm: Object.freeze({
        disposition: 'ADAPTED',
        reason: 'Emergency dispatch remains active; extra response time and hazard pay are authorized.',
        timeLimitMultiplier: 1.35,
        rewardMultiplier: 1.2
      })
    })
  }),
  [MISSION_WEATHER_POLICY_IDS.DRY_COMPETITION]: Object.freeze({
    defaultDisposition: 'ALLOWED',
    modes: Object.freeze({
      rain: Object.freeze({
        disposition: 'ADAPTED',
        reason: 'The wet-weather race uses a slower target time and increased purse.',
        timeLimitMultiplier: 1.25,
        rewardMultiplier: 1.15
      }),
      thunderstorm: Object.freeze({
        disposition: 'BLOCKED',
        reason: 'Race control has closed the course during the thunderstorm.'
      })
    })
  }),
  [MISSION_WEATHER_POLICY_IDS.SIGHTSEEING]: Object.freeze({
    defaultDisposition: 'ALLOWED',
    modes: Object.freeze({
      mist: Object.freeze({
        disposition: 'ADAPTED',
        reason: 'The sightseeing route is adapted to low-visibility landmarks.',
        timeLimitMultiplier: 1.1,
        rewardMultiplier: 1
      }),
      rain: Object.freeze({
        disposition: 'DELAYED',
        reason: 'The passenger is waiting for clearer sightseeing conditions.'
      }),
      thunderstorm: Object.freeze({
        disposition: 'BLOCKED',
        reason: 'The skyline tour is unavailable during the thunderstorm.'
      })
    })
  }),
  [MISSION_WEATHER_POLICY_IDS.ALL_WEATHER]: Object.freeze({
    defaultDisposition: 'ALLOWED',
    defaultReason: 'This activity is designed for the current weather.',
    modes: Object.freeze({})
  })
});

export function getMissionWeatherPolicy(policyOrId) {
  if (typeof policyOrId === 'string') return MISSION_WEATHER_POLICIES[policyOrId] || null;
  return policyOrId || null;
}

export default MISSION_WEATHER_POLICIES;

import useSWR from 'swr'
import BigNumber from 'bignumber.js'
import { useAccount } from 'wagmi'
import { SLOW_INTERVAL } from 'config/constants'
import { TRADING_REWARD_API } from 'config/constants/endpoints'
import tradingRewardABI from 'config/abi/tradingReward.json'
import { getTradingRewardAddress } from 'utils/addressHelpers'
import { multicallv2 } from 'utils/multicall'
import { CampaignIdInfoResponse, CampaignIdInfoDetail } from 'views/TradingReward/hooks/useCampaignIdInfo'
import { ChainId } from '@pancakeswap/sdk'

interface UserCampaignInfoResponse {
  id: string
  isActive: boolean
  lockEndTime: number
  lockStartTime: number
  lockedAmount: number
  createdAt: string
  isQualified: boolean
  thresholdLockedPeriod: number
  thresholdLockedAmount: string
  needsProfileActivated: boolean
}

export interface UserCampaignInfoDetail extends UserCampaignInfoResponse, CampaignIdInfoDetail {
  campaignId: string
  canClaim: string
  userClaimedIncentives: boolean
  campaignClaimTime?: number
  campaignClaimEndTime?: number
}

export interface AllUserCampaignInfo {
  isFetching: boolean
  data: UserCampaignInfoDetail[]
}

const useAllUserCampaignInfo = (campaignIds: Array<string>): AllUserCampaignInfo => {
  const { address: account } = useAccount()
  const tradingRewardAddress = getTradingRewardAddress(ChainId.BSC)

  const { data: allUserCampaignInfoData, isLoading } = useSWR(
    campaignIds.length > 0 && account && ['/all-campaign-id-info', account, campaignIds],
    async () => {
      try {
        const allUserCampaignInfo = await Promise.all(
          campaignIds.map(async (campaignId: string) => {
            const [userCampaignInfoResponse, userInfoQualificationResponse] = await Promise.all([
              fetch(`${TRADING_REWARD_API}/campaign/campaignId/${campaignId}/address/${account}`),
              fetch(`${TRADING_REWARD_API}/user/campaignId/${campaignId}/address/${account}`),
            ])

            const [userCampaignInfoResult, userInfoQualificationResult] = await Promise.all([
              userCampaignInfoResponse.json(),
              userInfoQualificationResponse.json(),
            ])

            const userCampaignInfo: CampaignIdInfoResponse = userCampaignInfoResult.data
            const userInfoQualification: UserCampaignInfoResponse = userInfoQualificationResult.data

            const totalVolume = userCampaignInfo.tradingFeeArr
              .map((i) => i.volume)
              .reduce((a, b) => new BigNumber(a).plus(b).toNumber(), 0)

            const totalTradingFee = userCampaignInfo.tradingFeeArr
              .map((i) => i.tradingFee)
              .reduce((a, b) => new BigNumber(a).plus(b).toNumber(), 0)

            const totalEstimateRewardUSD = userCampaignInfo.tradingFeeArr
              .map((i) => i.estimateRewardUSD)
              .reduce((a, b) => new BigNumber(a).plus(b).toNumber(), 0)

            const canClaimDataCalls = userCampaignInfo.tradingFeeArr
              .filter((a) => new BigNumber(a.tradingFee).gt(0))
              .map((i) => ({
                name: 'canClaim',
                address: tradingRewardAddress,
                params: [campaignId, account, new BigNumber(Number(i.tradingFee).toFixed(8)).times(1e18).toString()],
              }))

            const calls = [
              {
                name: 'userClaimedIncentives',
                address: tradingRewardAddress,
                params: [campaignId, account],
              },
              ...canClaimDataCalls,
            ]

            const contractData = await multicallv2({
              abi: tradingRewardABI,
              calls,
              chainId: ChainId.BSC,
              options: { requireSuccess: false },
            })

            const totalCanClaimData =
              contractData.length > 1
                ? contractData
                    .slice(1, contractData?.length)
                    .map((i) => i[0].toString() ?? 0)
                    .reduce((a, b) => new BigNumber(a).plus(b))
                    .toString() ?? '0'
                : '0'

            return {
              ...userCampaignInfo,
              ...userInfoQualification,
              campaignId,
              totalVolume,
              totalEstimateRewardUSD,
              totalTradingFee,
              canClaim: totalCanClaimData,
              userClaimedIncentives: contractData[0][0],
            }
          }),
        )

        return allUserCampaignInfo
      } catch (error) {
        console.info(`Fetch All User Campaign Info Error: ${error}`)
        return []
      }
    },
    {
      refreshInterval: SLOW_INTERVAL,
      fallbackData: [],
    },
  )

  return {
    isFetching: isLoading,
    data: allUserCampaignInfoData,
  }
}

export default useAllUserCampaignInfo

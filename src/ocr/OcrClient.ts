import { Scheduler, createScheduler, createWorker, RecognizeResult } from 'tesseract.js'
import axios, { AxiosResponse } from 'axios'
import store from '@/store/index'
import { BaiduTranslateReq } from '@/network/request/TranslateReq'
import { BaiduTranslateResp } from '@/network/response/TranslateResp'
import { Mutations } from '@/constant/Constants'
import qs from 'qs'
import { BaiduOcrReq } from '@/network/request/OcrReq'
import LangMapper from '../utils/LangMapper'
import { BaiduOcrResult } from '@/network/response/OcrResp'
import conf from '@/config/Conf'
import DateUtil from '@/utils/DateUtil'
import { BaiduTokenReq } from '@/network/request/BaiduTokenReq'
import { BaiduToken } from '@/network/response/BaiduToken'

/**
 * 文字识别
 */
export class OcrClient {
  private static client: OcrClient
  scheduler: Scheduler | null = null
  private recognizeText = ''

  static getInstance() {
    if (this.client == null) {
      this.client = new OcrClient()
    }
    return this.client
  }

  async init() {
    if (this.scheduler == null) {
      this.scheduler = createScheduler()
      const worker = createWorker({
        logger: m => {
          // const progress = m.progress
          // const status = m.status
          // console.log('progress:' + progress + '---status:' + status)
        },
        errorHandler: err => {
          console.log(err)
        },
        cacheMethod: 'none',
        langPath: window.location.origin + '/tess',
        corePath: window.location.origin + '/tess/tesseract-core.wasm.js',
        workerPath: window.location.origin + '/tess/worker.min.js'
      })
      await worker.load()
      await worker.loadLanguage('eng')
      await worker.initialize('eng')
      this.scheduler.addWorker(worker)
    }
  }

  /**
   * @param base64 识别图片
   */
  async recognize(base64: string) {
    try {
      // const res = await this.scheduler.addJob('recognize', base64) as RecognizeResult
      // 请求百度api token
      let token = conf.translate.get('baiduToken')
      if (token == null || !DateUtil.tokenValid(token.expires_in, token.create_time)) {
        const req = qs.stringify(new BaiduTokenReq())
        const tokenResp: AxiosResponse<BaiduToken> = await axios.get(
          `/baiduocr/oauth/2.0/token?${req}`
        )
        if (tokenResp.data.error) {
          console.log(tokenResp.data.error_description)
          return
        }
        token = tokenResp.data
        token.create_time = Date.now()
        conf.translate.set('baiduToken', token)
      }
      // ocr识别图片中文字
      const lang = LangMapper.toBaiduOcr(store.state.translate.source)
      let req = new BaiduOcrReq(base64)
      if (lang !== LangMapper.AUTO) {
        req = new BaiduOcrReq(base64, lang)
      }
      const res: AxiosResponse<BaiduOcrResult> = await axios.post(
        '/baiduocr/rest/2.0/ocr/v1/general_basic',
        qs.stringify(req),
        {
          headers: {'content-type': 'application/x-www-form-urlencoded'}
        })
      if (res.data.error_code) {
        console.log(res.data.error_msg)
        return
      }
      if (res.data.words_result.length === 0) {
        return
      }
      const text = res.data.words_result.map(v => v.words).reduce((prev, current) => `${prev}\n${current}`)
      if (text.trim().length > 2) {
        if (text !== this.recognizeText) {
          this.recognizeText = text
          const cancel = axios.CancelToken.source()
          const resp: AxiosResponse<BaiduTranslateResp> = await axios.get(
            '/baidufanyi/api/trans/vip/translate',
            {
              params: new BaiduTranslateReq(text),
              cancelToken: cancel.token
            })
          // console.log(`translate time: ${new Date().getTime()}`)
          const data = resp.data
          if (!data.error_code) {
            if (data.trans_result && data.trans_result.length > 0) {
              const src = data.trans_result[0].src
              const dst = data.trans_result[0].dst
              console.log(`recognizeText:${this.recognizeText}, src:${src}, dst:${dst}`)
              store.commit(Mutations.MUTATION_RESULT_TEXT, dst)
            }
          } else {
            console.log(`error code: ${data.error_code}`)
          }
        }
      }
    } catch (e) {
      console.log(e)
    }
  }
}

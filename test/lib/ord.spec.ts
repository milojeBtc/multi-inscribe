import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import { networks, initEccLib, Psbt, crypto, Transaction, payments, script, address } from 'bitcoinjs-lib'
import { InscriptionRequest, InscriptionTool } from '../../src/lib/ord'
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371'

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)

describe('ord', () => {
  it('inscribe', async () => {
    const ecPair = ECPair.fromPrivateKey(Buffer.from('your private key', 'hex'), {
      network: networks.testnet,
    })

    const request: InscriptionRequest = {
      commitUtxoList: [
        {
          hash: Buffer.from('your utxo hash', 'hex'),
          index: 1, // ...
        },
      ],
      commitUtxoECPairList: [ecPair],
      commitFeeRate: 4,
      feeRate: 5,
      dataList: [
        {
          contentType: 'text/plain;charset=utf-8',
          body: Buffer.from('Reinscribe', 'utf-8'),
          destination: 'tb1p8lh4np5824u48ppawq3numsm7rss0de4kkxry0z70dcfwwwn2fcspyyhc7',
        },
      ],
      revealOutValue: 999,
    }
    const tool = (await InscriptionTool.newTool('signet', request)).signTx()
    const recoveryKeyWIFList = tool.getRecoveryKeyWIFList()
    recoveryKeyWIFList.forEach((wif) => console.log(`wif: ${wif}`))
    console.log(`commitTx: ${tool.getCommitTxHex()}`)
    tool.getRevealTxHexList().forEach((revealTxHex) => console.log(`revealTx: ${revealTxHex}`))
    const result = await tool.inscribe()
    console.log(JSON.stringify(result))
    //  {"commitTxHash":"0755b25b3002105bc740c2046ee88475e1fbce301e744059e3c1c64174ee38c0","revealTxHashList":["449a165f50fdbbc6ad68838c654e5fd332de6034d543e8d0b3d02ef266e29f2e"],"inscriptions":["449a165f50fdbbc6ad68838c654e5fd332de6034d543e8d0b3d02ef266e29f2ei0"]}
    // {"commitTxHash":"4d53ac6ad7de27bbf792ed18c4b1ab4cb994fcfd50a383f823a3f6384ea63bb0","revealTxHashList":["f0cd7381ebf979caec63bbb122b5d79e0ee7364a84f1326379d601a05c809024"],"inscriptions":["f0cd7381ebf979caec63bbb122b5d79e0ee7364a84f1326379d601a05c809024i0"]}
  }, 100000000)

  it('reinscribe', async () => {
    const existsInscriptionUtxoEcPair = ECPair.fromPrivateKey(Buffer.from('your private key', 'hex'), {
      network: networks.testnet,
    })

    const commitUtxoEcPair = ECPair.fromPrivateKey(Buffer.from('your private key', 'hex'), {
      network: networks.testnet,
    })

    const request: InscriptionRequest = {
      existsInscriptionUtxoList: [
        {
          hash: Buffer.from('your exists inscription out point', 'hex'),
          index: 0, // ...
        },
      ],
      existsInscriptionUtxoECPairList: [existsInscriptionUtxoEcPair],
      commitUtxoList: [
        {
          hash: Buffer.from('out point for fee', 'hex'),
          index: 0, // ...
        },
      ],
      commitUtxoECPairList: [commitUtxoEcPair],
      commitFeeRate: 4,
      feeRate: 5,
      dataList: [
        {
          contentType: 'text/plain;charset=utf-8',
          body: Buffer.from(
            'Rescribe From efce76f7261f82ec83a0aef3822f8a6938cf25b7e4de62d9b4eff5023a7b54a8i0',
            'utf-8'
          ),
          destination: 'tb1p8lh4np5824u48ppawq3numsm7rss0de4kkxry0z70dcfwwwn2fcspyyhc7', // if reinscribe will ignore
        },
      ],
      revealOutValue: 999,
    }
    const tool = await InscriptionTool.newTool('signet', request)
    const recoveryKeyWIFList = tool.getRecoveryKeyWIFList()
    recoveryKeyWIFList.forEach((wif) => console.log(`wif: ${wif}`))
    console.log(`commitTx: ${tool.getCommitTxHex()}`)
    tool.getRevealTxHexList().forEach((revealTxHex) => console.log(`revealTx: ${revealTxHex}`))
    const result = await tool.inscribe()
    console.log(JSON.stringify(result))

    //   {"commitTxHash":"0c12c62af2399f4c14d35524636c8fa94307c4fe1d7c1ea05196923ade236a55","revealTxHashList":["8eb28951b89ca82dab150d54441dbe6e63f5e3b23942322e2fca76fbd618aa63"],"inscriptions":["8eb28951b89ca82dab150d54441dbe6e63f5e3b23942322e2fca76fbd618aa63i0"]}

    /**
     {"commitTxHash":"48ae4f0b3382d1fe9f811c262161d14db59b4e0b63633b22ec9a63992efdd229","revealTxHashList":["f711846211800f0b1bb34b28e62409f3324b092e3e946d182ceeecf47f4d4bdf"],"inscriptions":["f711846211800f0b1bb34b28e62409f3324b092e3e946d182ceeecf47f4d4bdfi0"]}
     {"commitTxHash":"9f2991132c8527cda815b275d2635c1ef9acf8f07474d1fbaad25bfe2e1cfe96","revealTxHashList":["ade5073f836644778bdb72c78602f3d53ac11835646ae32edde40a79cfbbf956"],"inscriptions":["ade5073f836644778bdb72c78602f3d53ac11835646ae32edde40a79cfbbf956i0"]}
     */

    /**
     {"commitTxHash":"8c587fcdf068bab58b9283582a6b4c3d78aff5eee740d540545a4aa911c9b631","revealTxHashList":["efce76f7261f82ec83a0aef3822f8a6938cf25b7e4de62d9b4eff5023a7b54a8"],"inscriptions":["efce76f7261f82ec83a0aef3822f8a6938cf25b7e4de62d9b4eff5023a7b54a8i0"]}
     {"commitTxHash":"bd2d42c356abb7fd0edcdee2cad0fa54856a1c94f9d7fbdcabe623b543acf322","revealTxHashList":["e99265c55ecbd01d057df9eb5422e20ebf018b111a7316ae3fa3fd50df47ba59"],"inscriptions":["e99265c55ecbd01d057df9eb5422e20ebf018b111a7316ae3fa3fd50df47ba59i0"]}
     */
  }, 100000000)

  it('reinscribe with psbt', async () => {
    const commitUtxoEcPair = ECPair.fromPrivateKey(Buffer.from('your private key', 'hex'), {
      network: networks.testnet,
    })
    const existsInscriptionUtxoPublicKey = 'your public key'
    const inscribeCtx = {
      contentType: 'text/plain;charset=utf-8',
      body: Buffer.from('Inscribe Test Test', 'utf-8'),
      destination: 'tb1p8lh4np5824u48ppawq3numsm7rss0de4kkxry0z70dcfwwwn2fcspyyhc7', // if reinscribe will ignore
    }
    const request: InscriptionRequest = {
      existsInscriptionUtxoList: [
        {
          hash: Buffer.from('289aab0a431f8184c14e7f7f2652615553f64687509e497fef1159d33b3a387f', 'hex'),
          index: 0, // ...
        },
      ],
      existsInscriptionUtxoECPairList: [
        ECPair.fromPublicKey(Buffer.from(existsInscriptionUtxoPublicKey, 'hex'), { network: networks.testnet }),
      ],
      commitUtxoList: [
        {
          hash: Buffer.from('you utxo hash for tx fee', 'hex'),
          index: 1, // ...
        },
      ],
      commitUtxoECPairList: [commitUtxoEcPair],
      commitFeeRate: 4,
      feeRate: 5,
      dataList: [inscribeCtx],
      revealOutValue: 999,
    }
    const tool = await InscriptionTool.newTool('signet', request)

    // pst
    let commitPsbtBuffer = tool.getCommitPsbt()
    console.log(`commitPsbt before sign: ${commitPsbtBuffer.toString('hex')}`)
    console.log(`commitPsbt before sign: ${commitPsbtBuffer.toString('base64')}`)
    {
      // sign or sign with in frontend
      const existsInscriptionUtxoEcPair = ECPair.fromPrivateKey(Buffer.from('your private key', 'hex'), {
        network: networks.testnet,
      })
      const psbt = Psbt.fromBuffer(commitPsbtBuffer)
      psbt.signInput(
        0,
        existsInscriptionUtxoEcPair.tweak(
          crypto.taggedHash('TapTweak', toXOnly(existsInscriptionUtxoEcPair.publicKey))
        ),
        [Transaction.SIGHASH_DEFAULT]
      )
      commitPsbtBuffer = psbt.toBuffer()
    }
    console.log(`commitPsbt after sign: ${commitPsbtBuffer.toString('hex')}`)
    console.log(`commitPsbt after sign: ${commitPsbtBuffer.toString('base64')}`)
    tool.setCommitPsbtAfterSignExistsInscriptionUtxoInput(commitPsbtBuffer).signTx()
    const recoveryKeyWIFList = tool.getRecoveryKeyWIFList()
    recoveryKeyWIFList.forEach((wif) => console.log(`wif: ${wif}`))
    console.log(`commitTx: ${tool.getCommitTxHex()}`)
    tool.getRevealTxHexList().forEach((revealTxHex) => console.log(`revealTx: ${revealTxHex}`))
    const result = await tool.inscribe()
    console.log(JSON.stringify(result))

    /**
     {"commitTxHash":"b28690b5cf8640b34264088af2f7b73bbc10e05e523caaf0a5da1aa79695bf5e","revealTxHashList":["289aab0a431f8184c14e7f7f2652615553f64687509e497fef1159d33b3a387f"],"inscriptions":["289aab0a431f8184c14e7f7f2652615553f64687509e497fef1159d33b3a387fi0"]}
     {"commitTxHash":"28d93bec4cf505630ece0b087fc930b17ad41c97e82db5b80c2886ab8a32d402","revealTxHashList":["1fba60569505ff1dae76aa14a7edde474f42422fb42e1650d5ce79422e27924d"],"inscriptions":["1fba60569505ff1dae76aa14a7edde474f42422fb42e1650d5ce79422e27924di0"]}
     */
  }, 100000000)
})

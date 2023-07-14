import { address, initEccLib, Network, payments, script, Transaction, TxOutput, Psbt, crypto } from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371'
import { LEAF_VERSION_TAPSCRIPT, tapTweakHash } from 'bitcoinjs-lib/src/payments/bip341'
import { ECPairInterface } from 'ecpair/src/ecpair'
import { bitcoin, regtest, testnet } from 'bitcoinjs-lib/src/networks'
// @ts-ignore
// noinspection ES6PreferShortImport
import { makeBitcoinAPI } from '@mempool/mempool.js/lib/services/api/index'
import { AxiosInstance, AxiosResponse } from 'axios'
import { useTransactions } from '@mempool/mempool.js/lib/app/bitcoin/transactions'

initEccLib(ecc)

const ECPair = ECPairFactory(ecc)

export interface Utxo {
  hash: Buffer
  index: number
  value?: number
  address?: string
}

export interface InscriptionData {
  contentType: string
  body: Buffer
  destination: string
}

export interface InscriptionRequest {
  existsInscriptionUtxoList?: Utxo[]
  existsInscriptionUtxoECPairList?: ECPairInterface[]
  commitUtxoList: Utxo[]
  commitUtxoECPairList: ECPairInterface[]
  commitFeeRate: number
  feeRate: number
  dataList: InscriptionData[]
  revealOutValue: number
}

export interface InscribeResult {
  commitTxHash: string
  revealTxHashList: string[]
  inscriptions: string[]
}

interface InscriptionTxCtxData {
  ecPair: ECPairInterface
  inscriptionScript: Buffer
  commitTxAddress: string
  controlBlock: Buffer
  tapHash: Buffer
  recoveryPrivateKeyWIF: string
}

interface BlockchainClient {
  btcApiClient: AxiosInstance
}

export class InscriptionTool {
  private static defaultSequenceNum = 0xfffffffd
  private static defaultRevealOutValue = 500
  private static maxStandardTxWeight = 400000
  private static zeroHash = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex')
  private static signatureSize = 64 // taproot
  private static validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean =>
    ECPair.fromPublicKey(pubkey).verify(msghash, signature)
  private static schnorrValidator = (pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean =>
    ecc.verifySchnorr(msghash, pubkey, signature)
  private net: Network = regtest
  private client: BlockchainClient = {} as any
  private existsInscriptionUtxoList: Utxo[] = []
  private existsInscriptionUtxoECPairList: ECPairInterface[] = []
  private commitUtxoECPairList: ECPairInterface[] = []
  private commitTxChangeECPair: ECPairInterface = {} as any
  private revealOutValue: number = InscriptionTool.defaultRevealOutValue
  private revealFeeRate: number = 1
  private txCtxDataList: InscriptionTxCtxData[] = []
  public revealPsbtList: Psbt[] = []
  private revealTxList: Transaction[] = []
  private commitTx?: Transaction
  private commitPsbt?: Psbt

  private constructor() {}

  public static async newTool(
    network: 'signet' | 'testnet' | 'mainnet',
    request: InscriptionRequest
  ): Promise<InscriptionTool> {
    const tool = new InscriptionTool()
    switch (network) {
      case 'signet':
      case 'testnet':
        tool.net = testnet
        break
      case 'mainnet':
        tool.net = bitcoin
        break
      default:
        throw new Error('unknown network')
    }
    tool.client = {
      btcApiClient: makeBitcoinAPI({ hostname: 'mempool.space', network }).api,
    }
    await tool.initTool(request)
    return tool
  }

  private createInscriptionTxCtxData(
    request: InscriptionRequest,
    indexOfRequestDataList: number
  ): InscriptionTxCtxData {
    const ecPair = ECPair.makeRandom()
    const textEncoder = new TextEncoder()
    const scriptChunks = [
      ecPair.publicKey.subarray(1),
      script.OPS.OP_CHECKSIG,
      script.OPS.OP_FALSE,
      script.OPS.OP_IF,
      Buffer.from(textEncoder.encode('ord')),
      0x01,
      0x01,
      Buffer.from(textEncoder.encode(request.dataList[indexOfRequestDataList].contentType)),
      script.OPS.OP_0,
      request.dataList[indexOfRequestDataList].body,
      script.OPS.OP_ENDIF,
    ]

    const inscriptionScript = script.compile(scriptChunks)

    const {
      address: commitTxAddress,
      hash,
      witness,
    } = payments.p2tr({
      internalPubkey: toXOnly(ecPair.publicKey),
      scriptTree: {
        output: inscriptionScript,
      },
      network: this.net,
      redeem: {
        output: inscriptionScript,
        redeemVersion: LEAF_VERSION_TAPSCRIPT,
      },
    })

    const recoveryPrivateKeyWIF = ECPair.fromPrivateKey(
      Buffer.from(ecc.privateAdd(ecPair.privateKey!, tapTweakHash(toXOnly(ecPair.publicKey), hash?.reverse()))!),
      {
        network: this.net,
      }
    ).toWIF()
    return {
      ecPair,
      inscriptionScript,
      commitTxAddress,
      controlBlock: witness![witness!.length - 1]!,
      tapHash: hash!,
      recoveryPrivateKeyWIF,
    } as InscriptionTxCtxData
  }

  private async initTool(request: InscriptionRequest): Promise<void> {
    if (request.existsInscriptionUtxoList?.length) {
      if (request.existsInscriptionUtxoList.length != request.dataList.length) {
        throw new Error('existsInscriptionUtxoList length is not equal to dataList length')
      }
      if (request.existsInscriptionUtxoList.length > 1) {
        throw new Error('existsInscriptionUtxoList length is greater than 1')
      }
      this.existsInscriptionUtxoList = request.existsInscriptionUtxoList
      if (request.existsInscriptionUtxoList.length != request.existsInscriptionUtxoECPairList?.length) {
        throw new Error('existsInscriptionUtxoList length is not equal to existsInscriptionUtxoECPairList length')
      }
      this.existsInscriptionUtxoECPairList = request.existsInscriptionUtxoECPairList
    }
    if (request.commitUtxoList.length == 0) {
      throw new Error('commitUtxoList length is 0')
    }
    this.commitUtxoECPairList = request.commitUtxoECPairList
    this.commitTxChangeECPair = request.commitUtxoECPairList[0]
    this.txCtxDataList = new Array(request.dataList.length)
    this.revealOutValue = request.revealOutValue || InscriptionTool.defaultRevealOutValue
    this.revealFeeRate = request.feeRate || 1
    const destinations = new Array<string>(request.dataList.length)
    for (let i = 0; i < request.dataList.length; i++) {
      this.txCtxDataList[i] = this.createInscriptionTxCtxData(request, i)
      destinations[i] = request.dataList[i].destination
    }

    const [revealPsbt, commitTxOutputForRevealList] = this.buildEmptyRevealTx(
      !!request.existsInscriptionUtxoList?.length,
      destinations,
      this.revealOutValue,
      this.revealFeeRate
    )
    this.revealPsbtList = revealPsbt
    await this.buildCommitTx(
      Object.assign(
        {
          commitTxOutputForRevealList,
        },
        request
      )
    )
  }

  private calculateRevealTxFee(withCommitTxOutputForFee: boolean, psbt: Psbt, feeRate: number): number {
    const tx = new Transaction()
    for (let i = 0; i < psbt.txInputs.length; i++) {
      const txInput = psbt.txInputs[i]
      tx.addInput(txInput.hash, txInput.index, txInput.sequence)
      tx.setWitness(i, [
        Buffer.alloc(InscriptionTool.signatureSize),
        this.txCtxDataList[i].inscriptionScript,
        this.txCtxDataList[i].controlBlock,
      ])
    }
    if (withCommitTxOutputForFee) {
      tx.addInput(psbt.txInputs[0].hash, psbt.txInputs[0].index, psbt.txInputs[0].sequence)
      tx.setWitness(psbt.txInputs.length, [Buffer.alloc(InscriptionTool.signatureSize)])
    }
    for (let txOutput of psbt.txOutputs) {
      tx.addOutput(txOutput.script, txOutput.value)
    }
    if (tx.weight() > InscriptionTool.maxStandardTxWeight) {
      throw new Error('reveal tx weight is greater than max standard tx weight')
    }
    return tx.virtualSize() * feeRate
  }

  private buildEmptyRevealTx(
    withCommitTxOutputForFee: boolean,
    destinations: string[],
    revealOutValue: number,
    feeRate: number
  ): [Psbt[], Array<TxOutput>] {
    const total = this.txCtxDataList.length
    const revealPsbt: Psbt[] = new Array(total)
    const commitTxOutputForRevealList: Array<TxOutput> = new Array(total)
    for (let i = 0; i < total; i++) {
      const psbt = new Psbt({ network: this.net })
      psbt.addInput({
        hash: InscriptionTool.zeroHash,
        index: i,
        sequence: InscriptionTool.defaultSequenceNum,
      })
      psbt.addOutput({
        script: address.toOutputScript(destinations[i], this.net),
        value: revealOutValue,
      })
      const prevOutput = revealOutValue + this.calculateRevealTxFee(withCommitTxOutputForFee, psbt, feeRate)
      commitTxOutputForRevealList[i] = {
        script: address.toOutputScript(this.txCtxDataList[i].commitTxAddress, this.net),
        value: prevOutput,
      }
      revealPsbt[i] = psbt
    }
    return [revealPsbt, commitTxOutputForRevealList]
  }

  private async getTxOutByTxOutPoint(outPoint: Utxo): Promise<{
    scriptpubkey: string
    scriptpubkey_asm: string
    scriptpubkey_type: string
    scriptpubkey_address: string
    value: number
  }> {
    const tx = await useTransactions(this.client.btcApiClient).getTx({ txid: outPoint.hash.toString('hex') } as any)
    if (outPoint.index >= tx.vout.length) {
      throw new Error('error out point')
    }
    return tx.vout[outPoint.index]
  }

  private calculateTxChangeAmount(
    psbt: Psbt,
    totalSenderAmount: number,
    feeRate: number,
    revealTx?: boolean
  ): [number, boolean] {
    const tx = new Transaction()
    for (let i = 0; i < psbt.txInputs.length; i++) {
      const txInput = psbt.txInputs[i]
      tx.addInput(txInput.hash, txInput.index, txInput.sequence)
      if (i == 0) {
        tx.setWitness(i, [Buffer.alloc(InscriptionTool.signatureSize)])
      } else {
        if (revealTx) {
          tx.setWitness(i, [
            Buffer.alloc(InscriptionTool.signatureSize),
            this.txCtxDataList[i - 1].inscriptionScript,
            this.txCtxDataList[i - 1].controlBlock,
          ])
        } else {
          tx.setWitness(i, [Buffer.alloc(InscriptionTool.signatureSize)])
        }
      }
    }
    let totalOutputAmount = 0
    for (let txOutput of psbt.txOutputs) {
      tx.addOutput(txOutput.script, txOutput.value)
      totalOutputAmount += txOutput.value
    }
    let txSize = tx.virtualSize()
    let change = totalSenderAmount - totalOutputAmount - txSize * feeRate
    if (change <= 0) {
      return [change, false]
    }
    // mock change output
    tx.addOutput(psbt.txOutputs[0].script, 0)
    txSize = tx.virtualSize()
    change = totalSenderAmount - totalOutputAmount - txSize * feeRate
    if (change <= 0) {
      return [0, false]
    } else {
      return [change, true]
    }
  }

  private async buildCommitTx({
    commitUtxoList,
    commitUtxoECPairList,
    commitFeeRate,
    commitTxOutputForRevealList,
    revealOutValue,
  }: {
    commitUtxoList: Utxo[]
    commitUtxoECPairList: ECPairInterface[]
    commitFeeRate: number
    commitTxOutputForRevealList: Array<TxOutput>
    revealOutValue: number
  }) {
    let totalSenderAmount = 0
    let psbt = new Psbt({ network: this.net })

    if (this.existsInscriptionUtxoList.length && this.existsInscriptionUtxoECPairList.length) {
      for (let i = 0; i < this.existsInscriptionUtxoList.length; i++) {
        const utxo = this.existsInscriptionUtxoList[i]
        if (utxo.value === undefined || utxo.address == undefined) {
          const txOut = await this.getTxOutByTxOutPoint(utxo)
          utxo.value = txOut.value
          utxo.address = txOut.scriptpubkey_address
        }
        psbt.addInput({
          hash: utxo.hash.reverse(),
          index: utxo.index,
          sequence: InscriptionTool.defaultSequenceNum,
          witnessUtxo: {
            script: address.toOutputScript(utxo.address, this.net),
            value: utxo.value,
          },
          tapInternalKey: toXOnly(this.existsInscriptionUtxoECPairList[i].publicKey),
        })
        totalSenderAmount += utxo.value
      }
    }

    let changePkScript: Buffer | undefined
    for (let i = 0; i < commitUtxoList.length; i++) {
      const utxo = commitUtxoList[i]
      if (utxo.value === undefined || utxo.address == undefined) {
        const txOut = await this.getTxOutByTxOutPoint(utxo)
        utxo.value = txOut.value
        utxo.address = txOut.scriptpubkey_address
      }
      if (changePkScript === undefined) {
        changePkScript = address.toOutputScript(utxo.address, this.net)
      }
      psbt.addInput({
        hash: utxo.hash.reverse(),
        index: utxo.index,
        sequence: InscriptionTool.defaultSequenceNum,
        witnessUtxo: {
          script: address.toOutputScript(utxo.address, this.net),
          value: utxo.value,
        },
        tapInternalKey: toXOnly(commitUtxoECPairList[i].publicKey),
      })
      totalSenderAmount += utxo.value
    }

    if (this.existsInscriptionUtxoList.length) {
      commitTxOutputForRevealList.forEach((txOutput, i) =>
        psbt.addOutput({ script: txOutput.script, value: this.existsInscriptionUtxoList[i].value! })
      )
    } else {
      commitTxOutputForRevealList.forEach((txOutput) => psbt.addOutput(txOutput))
    }

    // change output
    {
      const tempPsbtForCalculateChange = psbt.clone()
      commitTxOutputForRevealList.forEach((txOutput) => tempPsbtForCalculateChange.addOutput(txOutput))
      const [changeAmount, addChangeOutput] = this.calculateTxChangeAmount(
        tempPsbtForCalculateChange,
        totalSenderAmount,
        commitFeeRate
      )
      if (this.existsInscriptionUtxoList.length) {
        const totalRevealFee =
          commitTxOutputForRevealList.reduce((accumulator, { value }) => accumulator + value, 0) -
          revealOutValue * commitTxOutputForRevealList.length
        if (changeAmount < totalRevealFee) {
          throw new Error('insufficient balance for commit tx and reveal tx')
        }
      }
      if (changeAmount < 0) {
        throw new Error('insufficient balance for commit tx')
      }
      if (addChangeOutput) {
        psbt.addOutput({ script: changePkScript!, value: changeAmount })
      }
    }

    this.commitPsbt = psbt
  }

  public getCommitPsbt() {
    return this.commitPsbt!.toBuffer()
  }

  public setCommitPsbtAfterSignExistsInscriptionUtxoInput(psbtBuffer: Buffer) {
    const psbt = Psbt.fromBuffer(psbtBuffer, { network: this.net })
    for (let i = 0; i < psbt.txInputs.length; i++) {
      if (this.existsInscriptionUtxoECPairList.length) {
        if (i < this.existsInscriptionUtxoECPairList.length) {
          if (
            psbt.data.inputs[i].finalScriptSig == undefined &&
            psbt.data.inputs[i].finalScriptWitness == undefined &&
            !psbt.validateSignaturesOfInput(i, InscriptionTool.validator)
          ) {
            throw new Error(`invalid signature ${i}`)
          }
        }
      }
    }
    this.commitPsbt = psbt
    return this
  }

  private signCommitTx() {
    const psbt = this.commitPsbt!
    for (let i = 0; i < psbt.txInputs.length; i++) {
      if (this.existsInscriptionUtxoList.length) {
        if (i < this.existsInscriptionUtxoList.length) {
          if (
            psbt.data.inputs[i].finalScriptSig !== undefined ||
            psbt.data.inputs[i].finalScriptWitness !== undefined
          ) {
            continue
          }
          if (psbt.validateSignaturesOfInput(i, InscriptionTool.validator)) {
            psbt.finalizeInput(i)
            continue
          }
          if (this.existsInscriptionUtxoECPairList[i]) {
            psbt.signInput(
              i,
              this.existsInscriptionUtxoECPairList[i].tweak(
                crypto.taggedHash('TapTweak', toXOnly(this.existsInscriptionUtxoECPairList[i].publicKey))
              ),
              [Transaction.SIGHASH_DEFAULT]
            )
          }
        } else {
          psbt.signInput(
            i,
            this.commitUtxoECPairList[i - this.existsInscriptionUtxoList.length].tweak(
              crypto.taggedHash(
                'TapTweak',
                toXOnly(this.commitUtxoECPairList[i - this.existsInscriptionUtxoList.length].publicKey)
              )
            ),
            [Transaction.SIGHASH_DEFAULT]
          )
        }
      } else {
        psbt.signInput(
          i,
          this.commitUtxoECPairList[i].tweak(
            crypto.taggedHash('TapTweak', toXOnly(this.commitUtxoECPairList[i].publicKey))
          ),
          [Transaction.SIGHASH_DEFAULT]
        )
      }
      psbt.finalizeInput(i)
    }
    this.commitTx = psbt.extractTransaction(true)
  }

  private completeAndSignRevealTx() {
    const withCommitTxOutputForFee = !!this.existsInscriptionUtxoList.length
    const _revealPsbt = this.revealPsbtList
    const revealPsbt: Psbt[] = new Array(_revealPsbt.length)
    const commitTx = this.commitTx!
    const commitTxHash = commitTx.getHash()
    for (let i = 0; i < _revealPsbt.length; i++) {
      revealPsbt[i] = new Psbt({ network: this.net })
      let totalSenderAmount = 0
      for (let j = 0; j < _revealPsbt[i].txInputs.length; j++) {
        const commitTxOutputIndex = _revealPsbt.length == 1 ? j : i
        revealPsbt[i].addInput({
          hash: commitTxHash,
          index: commitTxOutputIndex,
          tapLeafScript: [
            {
              leafVersion: LEAF_VERSION_TAPSCRIPT,
              script: this.txCtxDataList[i].inscriptionScript,
              controlBlock: this.txCtxDataList[i].controlBlock,
            },
          ],
          sequence: InscriptionTool.defaultSequenceNum,
          witnessUtxo: commitTx.outs[commitTxOutputIndex],
          tapInternalKey: toXOnly(this.txCtxDataList[i].ecPair.publicKey),
        })
        totalSenderAmount += commitTx.outs[commitTxOutputIndex].value
      }

      for (let j = 0; j < _revealPsbt[i].txOutputs.length; j++) {
        const commitTxOutputIndex = _revealPsbt.length == 1 ? j : i
        revealPsbt[i].addOutput({
          script: _revealPsbt[i].txOutputs[j].script,
          value: withCommitTxOutputForFee ? commitTx.outs[commitTxOutputIndex].value : this.revealOutValue,
        })
      }

      if (withCommitTxOutputForFee) {
        // fee input
        revealPsbt[i].addInput({
          hash: commitTxHash,
          index: commitTx.outs.length - 1,
          sequence: InscriptionTool.defaultSequenceNum,
          witnessUtxo: commitTx.outs[commitTx.outs.length - 1],
          tapInternalKey: toXOnly(this.commitTxChangeECPair.publicKey),
        })
        totalSenderAmount += commitTx.outs[commitTx.outs.length - 1].value

        // change output
        const tempPsbtForCalculateChange = revealPsbt[i].clone()
        _revealPsbt[i].txOutputs.forEach((txOutput) => tempPsbtForCalculateChange.addOutput(txOutput))
        const [changeAmount, addChangeOutput] = this.calculateTxChangeAmount(
          tempPsbtForCalculateChange,
          totalSenderAmount,
          this.revealFeeRate
        )
        if (changeAmount < 0) {
          throw new Error('insufficient balance for reveal tx')
        }
        if (addChangeOutput) {
          revealPsbt[i].addOutput({ script: commitTx.outs[commitTx.outs.length - 1].script, value: changeAmount })
        }
      }
    }

    for (let i = 0; i < revealPsbt.length; i++) {
      for (let j = 0; j < revealPsbt[i].txInputs.length; j++) {
        if (withCommitTxOutputForFee && j == revealPsbt[i].txInputs.length - 1) {
          revealPsbt[i].signInput(
            j,
            this.commitTxChangeECPair.tweak(
              crypto.taggedHash('TapTweak', toXOnly(this.commitTxChangeECPair.publicKey))
            ),
            [Transaction.SIGHASH_DEFAULT]
          )
        } else {
          revealPsbt[i].signInput(j, this.txCtxDataList[revealPsbt.length != 1 ? i : j].ecPair, [
            Transaction.SIGHASH_DEFAULT,
          ])
        }
      }
    }

    this.revealPsbtList = revealPsbt
    this.revealTxList = new Array(revealPsbt.length)
    for (let i = 0; i < revealPsbt.length; i++) {
      this.revealTxList[i] = revealPsbt[i].finalizeAllInputs().extractTransaction(true)
    }
  }

  public signTx() {
    this.signCommitTx()
    this.completeAndSignRevealTx()
    return this
  }

  public getRecoveryKeyWIFList(): string[] {
    const wifList = new Array<string>(this.txCtxDataList.length)
    for (let i = 0; i < this.txCtxDataList.length; i++) {
      wifList[i] = this.txCtxDataList[i].recoveryPrivateKeyWIF
    }
    return wifList
  }

  public getCommitTxHex(): string | undefined {
    return this.commitTx?.toHex()
  }

  public getRevealTxHexList(): string[] {
    return this.revealTxList.map((tx) => tx.toHex())
  }

  private async broadcastTx(tx: Transaction, maxRetries = 3) {
    let retries = 0
    let response: AxiosResponse<string> | undefined
    while (retries < maxRetries) {
      try {
        response = await this.client.btcApiClient.post<string>('/tx', tx.toHex())
        return response.data
      } catch (e: any) {
        if (response !== undefined) {
          console.error(
            `broadcastTx error: ${retries} ${tx.getId()} ${response.status} ${response.statusText} ${
              response.data
            }, ${e} hex: ${tx.toHex()} `
          )
        }
        retries++
        if (retries === maxRetries) {
          throw e
        }
      }
    }
  }

  public async inscribe(): Promise<InscribeResult> {
    const commitTxHash = await this.broadcastTx(this.commitTx!)
    const revealTxHashList = new Array<string>(this.revealTxList.length)
    const inscriptions = new Array<string>(this.txCtxDataList.length)
    for (let i = 0; i < this.revealTxList.length; i++) {
      console.log(this.revealTxList[i].toHex())
      const revealTxHash = await this.broadcastTx(this.revealTxList[i])
      revealTxHashList[i] = revealTxHash || ''
      if (this.revealTxList.length == this.txCtxDataList.length) {
        inscriptions[i] = `${revealTxHash}i0`
      } else {
        inscriptions[i] = `${revealTxHash}i`
      }
    }
    if (this.revealTxList.length != this.txCtxDataList.length) {
      for (let i = inscriptions.length - 1; i > 0; i--) {
        inscriptions[i] = `${inscriptions[0]}${i}`
      }
    }
    return {
      commitTxHash: commitTxHash || '',
      revealTxHashList,
      inscriptions,
    }
  }
}

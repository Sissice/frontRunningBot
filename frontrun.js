var Web3 = require('web3');
var fetch = require('node-fetch');
var Tx = require('ethereumjs-tx').Transaction;

const { ERC20_ABI, UNISWAP_ROUTER_ABI } = require('./constants.js');
const { ethers } = require("ethers")
const UNISWAP = require("@uniswap/sdk")
const { Token, WETH, Fetcher, Route, Trade, TokenAmount, TradeType, Percent } = require("@uniswap/sdk");

const NETWORK = "eth-goerli";
const PROJECT_ID = require("./key.js")
const web3 = new Web3(new Web3.providers.HttpProvider(`https://${NETWORK}.g.alchemy.com/v2/${PROJECT_ID}`));
const NETWORK_URL = `https://goerli.infura.io/v3/`;

const QUICKNODE_HTTP_ENDPOINT = `https://eth-goerli.g.alchemy.com/v2/${PROJECT_ID}`
let provider = new ethers.providers.getDefaultProvider(QUICKNODE_HTTP_ENDPOINT)

// Uniswap 合约地址
const UNISWAP_ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
// WETH 地址
const ETH_TOKEN_ADDRESS = '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6';
// TUSD 地址
const TUSD_TOKEN_ADDRESS = '0x60450439A3d91958E9Dae0918FC4e0d59a77f896';

// 获取 uniswap 合约实例
UNISWAP_ROUTER_CONTRACT = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, UNISWAP_ROUTER_ABI, provider)
// 获取 TUSD 合约实例
ERC20_CONTRACT = new ethers.Contract(TUSD_TOKEN_ADDRESS, ERC20_ABI, provider)


// 函数选择器
const swapExactTokensForETH = '0x18cbafe5';
const swapExactETHForTokens = '0x7ff36ab5';
// wallet address for fee sharing program
const WALLET_ID = "0x0000000000000000000000000000000000000000"
const ETH_DECIMALS = 18;
const TUSD_DECIMALS = 18;
// 想买的 TUSD
const TUSD_QTY = 1;
// 想卖的 ETH
const ETH_QTY = 0.002;
const ETH_QTY_WEI = ETH_QTY * 10 ** ETH_DECIMALS;
// 触发抢跑运行攻击的阈值
const THRESHOLD = 1;
// Gas price
const GAS_PRICE = 'medium';
// one gwei
// 需要增加的gasPrice
const ONE_GWEI = 1e9;
// max gas price
const MAX_GAS_PRICE = 50000000000;
// 我的钱包地址
const USER_ACCOUNT = '0x9DC97146b924263A2c8C7237FbeEAFb6ef60b624';
// 我的私钥
const privateKey = require("./key.js")
const wallet = new ethers.Wallet(privateKey, provider)

// 标识抢跑是否成功
var succeed = false;

var subscription;

async function main() {
  // get token balance before
  // 获得交易以前的代币余额
  let tokenBalanceBefore = await getTokenBalance(TUSD_TOKEN_ADDRESS);
  // 监控待处理交易
  const web3Ws = new Web3(new Web3.providers.WebsocketProvider(`wss://${NETWORK}.g.alchemy.com/v2/${PROJECT_ID}`));
  subscription = web3Ws.eth.subscribe('pendingTransactions', function (error, result) {
  }).on("data", async function (transactionHash) {
    let transaction = await web3.eth.getTransaction(transactionHash);
    // 筛选和进行抢跑
    await handleTransaction(transaction);

    if (succeed) {
      console.log("Front-running attack succeed.");
      // 出售 token
      let tokenBalanceAfter = await getTokenBalance(TUSD_TOKEN_ADDRESS);
      let srcAmount = (tokenBalanceAfter - tokenBalanceBefore) / (10 ** TUSD_DECIMALS);
      console.log("Get " + srcAmount + " Tokens.");
      console.log("Begin selling the tokens.");
      await performTrade(TUSD_TOKEN_ADDRESS, ETH_TOKEN_ADDRESS, srcAmount);
      console.log("End.")
      process.exit();
    }
  })
}

async function handleTransaction(transaction) {
  // 选出对应的交易
  if (transaction.to == UNISWAP_ROUTER_ADDRESS && await isPending(transaction.hash)) {
    console.log("Found pending uniswap network transaction", transaction);
  } else {
    return
  }
  // 计算gas
  let gasPrice = parseInt(transaction['gasPrice']);
  let newGasPrice = gasPrice + ONE_GWEI;
  if (newGasPrice > MAX_GAS_PRICE) {
    newGasPrice = MAX_GAS_PRICE;
  }

  // 判断符合触发抢跑交易d的条件后，再进行抢跑
  if (triggersFrontRun(transaction)) {
    subscription.unsubscribe();
    console.log('Perform front running attack...');
    await performTrade(ETH_TOKEN_ADDRESS, TUSD_TOKEN_ADDRESS, ETH_QTY, newGasPrice);
    // 等待抢跑交易成功，并更改状态
    console.log("wait until the honest transaction is done...");
    while (await isPending(transaction.hash)) { }
    succeed = true;
  }
}

// 判断是否能触发抢跑交易
function triggersFrontRun(transaction) {
  if (transaction.to != UNISWAP_ROUTER_ADDRESS) {
    return false
  }
  let data = parseTx(transaction.input);
  let method = data[0], params = data[1];

  if (method == swapExactETHForTokens) {
    console.log(params)
    let srcAddr = params[5], srcAmount = params[0], toAddr = params[6];
    // console.log()
    return (srcAddr == ETH_TOKEN_ADDRESS) &&
      (toAddr == TUSD_TOKEN_ADDRESS) && (srcAmount >= THRESHOLD)
  }
  return false
}


async function performTrade(srcAddr, destAddr, srcAmount, gasPrice = null) {
  console.log('Begin transaction...');
  console.log("srcAddr", srcAddr)
  console.log("destAddr", destAddr)
  console.log("srcAmount", srcAmount)
  console.log("gasPrice", gasPrice)

  // 判断是该卖还是买
  if (srcAddr == ETH_TOKEN_ADDRESS) {
    const token1 = new Token(
      UNISWAP.ChainId.GÖRLI,
      destAddr,
      18
    );
    console.log('swapExactETHForTokens')
    await swapTokens(token1, WETH[token1.chainId], srcAmount, "1000", gasPrice, 'swapExactETHForTokens')
  }
  if (destAddr == ETH_TOKEN_ADDRESS) {
    const token2 = new Token(
      UNISWAP.ChainId.GÖRLI,
      srcAddr,
      18
    );
    console.log('swapExactTokensForETH')
    await swapTokens(WETH[token2.chainId], token2, srcAmount, "1000", gasPrice, 'swapExactTokensForETH')
  }

  // 交易完成后输出
  console.log("Transaction DONE!");
}

// 判断是否是pending中的交易
async function isPending(transactionHash) {
  return await web3.eth.getTransactionReceipt(transactionHash) == null;
}

// 解析input
function parseTx(input) {
  if (input == '0x') {
    return ['0x', []]
  }
  if ((input.length - 8 - 2) % 64 != 0) {
    throw "Data size misaligned with parse request."
  }
  let method = input.substring(0, 10);
  let numParams = (input.length - 8 - 2) / 64;
  var params = [];
  for (i = 0; i < numParams; i += 1) {
    let param = parseInt(input.substring(10 + 64 * i, 10 + 64 * (i + 1)), 16);
    params.push(param);
  }
  return [method, params]
}

// 获取对应token的余额
async function getTokenBalance(tokenAddr) {
  const TOKEN_CONTRACT = new web3.eth.Contract(ERC20_ABI, tokenAddr);
  return await TOKEN_CONTRACT.methods.balanceOf(USER_ACCOUNT).call();
}

// 进行交换操作
async function swapTokens(token1, token2, amount, slippage, gasPrice, method0) {

  try {
    // 创建 pair 实例
    const pair = await Fetcher.fetchPairData(token1, token2, provider);
    // 指定输入token到输出token的路径
    const route = await new Route([pair], token2);
    // 将 ETH 转化为 wei
    let amountIn = ethers.utils.parseEther(amount.toString());
    amountIn = amountIn.toString()

    // 计算滑点，slippage=50意味着允许0.5%以内的价格波动
    const slippageTolerance = new Percent(slippage, "10000");


    let rawTxn;
    console.log("method0", method0)
    // 根据卖和买进行不同的操作
    // 买
    if (method0.toString() == 'swapExactETHForTokens') {

      // 创建 swap 交易所需要的信息
      const trade = new Trade(
        route,
        new TokenAmount(token2, amountIn),
        TradeType.EXACT_INPUT
      );

      // 根据滑点，计算最少需要得到的代币数量，需要转化为十六进制
      const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
      const amountOutMinHex = ethers.BigNumber.from(amountOutMin.toString()).toHexString();
      // 路径的数组
      const path = [token2.address, token1.address];
      // 代币接收地址
      const to = wallet.address;
      // 20分钟
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      // 需要转化为十六进制
      const value = trade.inputAmount.raw;
      const valueHex = await ethers.BigNumber.from(value.toString()).toHexString();

      console.log('swapExactETHForTokens')
      // 打包 swapExactETHForTokens 交易参数
      rawTxn = await UNISWAP_ROUTER_CONTRACT.populateTransaction.swapExactETHForTokens(amountOutMinHex, path, to, deadline, {
        value: valueHex,
        gasLimit: '0x4A519', //304409
        gasPrice: gasPrice
      })
    }

    // 卖
    if (method0.toString() == 'swapExactTokensForETH') {
      const path = [token2.address, token1.address];
      const to = wallet.address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      // 需要先进行 approve
      console.log("approve")
      // 打包 approve 的交易参数
      const apprawTxn = await ERC20_CONTRACT.populateTransaction.approve(UNISWAP_ROUTER_ADDRESS, amountIn, {
        value: 0,
        gasLimit: '0x23419' //144409
      })

      // 发送交易
      let appsendTxn = (await wallet).sendTransaction(apprawTxn)
      console.log("appsendTxn", appsendTxn)

      // 一旦交易被包含在 x 确认块的链中，就解析为 TransactionReceipt。
      let appreciept = (await appsendTxn).wait()
      // //记录有关 approve 已被挖掘的交易的信息。
      if (appreciept) {
        console.log(" - approve is mined - " + '\n'
          + "Transaction Hash:", (await appsendTxn).hash
          + '\n' + "Block Number: "
          + (await appreciept).blockNumber + '\n'
          + "Navigate to https://goerli.etherscan.io/txn/"
        + (await appsendTxn).hash, "to see your transaction")
      } else {
        console.log("Error submitting transaction")
      }
      console.log('swapExactTokensForETH')

      // 打包 swapExactTokensForETH 交易参数
      rawTxn = await UNISWAP_ROUTER_CONTRACT.populateTransaction.swapExactTokensForETH(amountIn, 0, path, to, deadline, {
        value: 0,
        gasLimit: '0x4A519', //304409
        gasPrice: gasPrice
      })
    }

    //返回解析为事务的 Promise。
    let sendTxn = (await wallet).sendTransaction(rawTxn)

    // 一旦交易被包含在 x 确认块的链中，就解析为 TransactionReceipt。
    let reciept = (await sendTxn).wait()
    console.log("reciept", reciept)

    //记录有关 swap 已被挖掘的交易的信息。
    if (reciept) {
      console.log(" - Transaction is mined - " + '\n'
        + "Transaction Hash:", (await sendTxn).hash
        + '\n' + "Block Number: "
        + (await reciept).blockNumber + '\n'
        + "Navigate to https://goerli.etherscan.io/txn/"
      + (await sendTxn).hash, "to see your transaction")
    } else {
      console.log("Error submitting transaction")
    }

  } catch (e) {
    console.log(e)
  }
}

main();


// for test only
async function test() {
  let token = await getTokenBalance(KNC_TOKEN_ADDRESS);
  console.log(token);
}

// test();

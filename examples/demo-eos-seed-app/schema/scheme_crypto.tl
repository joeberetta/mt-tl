---types---

crypto.sentCode#a76e51b8 key_registered:Bool code:string server_sign:string = crypto.SentCode;
crypto.tokenBalance#8dc54265 symbol:string balance:string name:string unread_count:int balance_usd:string = crypto.TokenBalance;
crypto.balance#ccaa072d tokens:Vector<crypto.TokenBalance> unread_count:int total_balance_usd:string = crypto.Balance;

crypto.transaction#281e893e flags:# tx_id:string symbol:string date:int actions:Vector<crypto.TransactionAction> note:flags.0?string type:crypto.TransactionType explorer_url:flags.1?string read:flags.2?true = crypto.Transaction;

crypto.externalStatusFailed#aa0d6ba1 = crypto.ExternalTransactionStatus;
crypto.externalStatusPending#1c07606e = crypto.ExternalTransactionStatus;
crypto.externalStatusConfirmed#d90e62b8 = crypto.ExternalTransactionStatus;

crypto.transactionAction#392fd23a from_id:int to_id:int amount:string memo:string = crypto.TransactionAction;
crypto.transactionAction#38d78a50 from_id:int to_id:int amount:string symbol:string memo:string = crypto.TransactionAction;

inputMediaCrypto#02c2fe4e tx_id:string symbol:string amount:string = InputMedia;

messageMediaCryptoTypeDefault#520ba4cb = MediaCryptoType;
messageMediaCryptoTypeTrade#ed8b9406 = MediaCryptoType;
messageMediaCryptoTypeGift#dbefc5ef = MediaCryptoType;
messageMediaCrypto#e199ee95 txId:string symbol:string amount:string type_operation:MediaCryptoType = MessageMedia;
messageMediaCryptoFull#d6febe18 symbol:string amount:string tx_data:crypto.Transaction = MessageMedia;

crypto.updateWalletsConfig#8f5007a2 config:crypto.WalletsConfig = Update;
crypto.updateNewTx#7fe0bc5f tx:crypto.Transaction pts:int = Update;
crypto.updateNewBalance#eb8da021 balance:crypto.Balance pts:int = Update;
crypto.updateTxInfo#6dcb10ba tx:crypto.Transaction pts:int = Update;
crypto.updateReadTx#50d89950 txs_ids:Vector<string> pts:int pts_count:int = Update;

cryptoWalletTypeCrypto#fcfc98e6 = CryptoWalletType;
cryptoWalletTypeFiat#7ae3b545 = CryptoWalletType;

// конфиг монеты
// symbol - символ монеты в бч, так-же именно его надо использовать в запросах с symbol
// type - фиат или крипта
// name - Полное имя монетки (BTC -> Bitcoin)
// decimals - количество знаков после запятой у токена
// display_decimals - количество отображаемых знаков
// unit - каким символом измеряется валюта (XAUT имеет OZT)
// network - к какой сети принадлежит монета BTC -> Bitcoin, ETH -> Ethereum и т.д.
// token_type - формат токена, зависит от сети пример ERC-20 (Ethereum), TRC-20 (Tron)
// is_credit_token - кредитный токен, для него действуют определенные правила (нельзя передавать, можно юзать только при покупке с автообменом)
// is_promo_token - промо токен, для него действуют определенные правила (нельзя передавать, можно юзать только при покупке с автообменом. Можно менять в свапе луну на этот токен)

// Список ограничений, согласно которым, необходимо исключить из экранов/модалок выбора валют соответствующую монету
// ban_direct - перевод между пользователями (если юзер решил обмануть систему и через экран Send найдет юзера, то при попытке нажать на Send, светить соответствующую ошибку, что Sorry, cannot transfer this coin)
// ban_deposit - для экрана получения адреса пополнения кошелька в воллетах
// ban_withdraw - для экранов отправки транзакции на вывод
// ban_gift - для создания гифт карты
// ban_payme - для запроса денег
// ban_exchange_from - для экрана эксчендж чата (монета, которую пытаешься обменять, левая часть модалки)
// ban_exchange_to - для экрана эксчендж чата (монета, на которую пытаешься обменять, правая часть модалки)
// ban_order_payment - для оплаты товаров
// ban_defi - для инвестирования в дефи
// ban_price_tags - для price тэгов
// ban_price_tags - для price тэгов
// ban_defi_withdraw - для вывода из дефи
// ban_payme_payment - для оплаты payme
// ban_loan_payoff - для оплаты кредита

crypto.walletConfig#12353921 flags:# id:int symbol:string display_symbol:string type:CryptoWalletType name:string decimals:int display_decimals:int unit:string network:string token_type:flags.10?string is_credit_token:flags.11?true is_promo_token:flags.12?true price:flags.0?string input_min:flags.1?double input_max:flags.2?double output_min:flags.3?double output_max:flags.4?double internal_min:flags.5?double internal_max:flags.6?double input_commission:flags.7?double output_commission:flags.8?double internal_commission:flags.9?double ban_direct:flags.13?true ban_deposit:flags.14?true ban_withdraw:flags.15?true ban_gift:flags.16?true ban_payme:flags.17?true ban_exchange_from:flags.18?true ban_exchange_to:flags.19?true ban_order_payment:flags.20?true ban_defi:flags.21?true ban_price_tags:flags.22?true ban_defi_withdraw:flags.23?true ban_payme_payment:flags.24?true ban_loan_payoff:flags.25?true ban_internal_cards_deposit:flags.26?true = CryptoWalletConfig;
crypto.walletsConfig#9472c2bc wallets:Vector<CryptoWalletConfig> = crypto.WalletsConfig;

crypto.transactionTypeEscrow#27c4dd40 flags:# from_id:int to_id:int status:escrow.TransactionStatus attachments:Vector<escrow.TransactionAttachment> date:int end_date:flags.0?int order_data:flags.1?shop.Order = crypto.TransactionType;

crypto.transactionTypeDefault#caaddc7f = crypto.TransactionType;
crypto.transactionTypeGift#4a89df29 flags:# id:flags.0?int = crypto.TransactionType;
crypto.transactionTypeTrade#69249bd7 = crypto.TransactionType;
crypto.transactionTypeExternal#970d4914 flags:# tx_status:crypto.ExternalTransactionStatus external_tx_id:flags.0?string explorer_url:flags.1?string tx_fee:flags.2?string = crypto.TransactionType;
crypto.transactionTypeDustSwap#5a25780a flags:int order_id:flags.0?string target_symbol:flags.1?string tx_fee:flags.2?string = crypto.TransactionType;
crypto.transactionTypeReward#58220dd4 = crypto.TransactionType;
crypto.transactionTypeDemoInvest#02db20b9 flags:# action:invest.PaymentAction position_id:flags.0?string = crypto.TransactionType;

// Stripe: фиат в metadata usersTx (fiat_total_amount, fiat_total_fee, fiat_currency, payment_intent_id); зачисление — в actions
crypto.transactionTypeStripeTopUp#000af63c fiat_total_amount:string fiat_total_fee:string fiat_currency:string = crypto.TransactionType;
// Stripe OpenAPI: полный ордер; зачисление — в actions
crypto.transactionTypeStripeInvoice#9526232a flags:# order_data:flags.0?shop.Order = crypto.TransactionType;
// EIP (крипто) оплата OpenAPI заказа; зачисление — в actions
crypto.transactionTypeExternalPaymentInvoice#7b06cd53 flags:# order_data:flags.0?shop.Order = crypto.TransactionType;

crypto.walletActionWithdraw#4394cdf8 = crypto.WalletAction;
crypto.walletActionDeposit#e8983de5 = crypto.WalletAction;
crypto.walletActionTransfer#095fd686 = crypto.WalletAction;

crypto.userBlockRuleAllow#20d5f78d wallet:CryptoWalletType action:crypto.WalletAction = crypto.UserBlockRule;
crypto.userBlockRuleDisallow#c3d48395 wallet:CryptoWalletType action:crypto.WalletAction = crypto.UserBlockRule;
crypto.userBlockRuleAllowAll#29db37a1 = crypto.UserBlockRule;
crypto.userBlockRuleDisallowAll#cd09a104 = crypto.UserBlockRule;

crypto.userBlockData#dcc6cbe9 rules:Vector<crypto.UserBlockRule> = crypto.UserBlockData;

---functions---
crypto.sendCode#01ef6a96 public_key:string api_id:int api_hash:string = crypto.SentCode;
crypto.signUp#991064e6 flags:# public_key:string code:string server_sign:string sign:string phone_number:string first_name:string last_name:string email:string username:string country:flags.0?string = auth.Authorization;
crypto.signIn#3c55e6fa public_key:string code:string server_sign:string sign:string = auth.Authorization;

// Escrow
---types---

// Статусы escrow транзакции
// Транзакция создана, средства захолдированы на escrow счете
escrow.transactionStatusActive#44662349 = escrow.TransactionStatus;
// Перевод отменен, средства возвращены отправителю
escrow.transactionStatusCanceled#a88c399b = escrow.TransactionStatus;
// Перевод подтвержден. Отправитель разхолдировал средства
escrow.transactionStatusCompleted#11d4e0ee = escrow.TransactionStatus;
// Транзакция в статусе спора
escrow.transactionStatusDisput#9120d5aa = escrow.TransactionStatus;

updateNewTxEscrow#5cf686b7 tx:crypto.Transaction users:Vector<User> = Update;
updateEscrowTx#5d7d3569 tx:crypto.Transaction users:Vector<User> = Update;
escrow.transactionAttachment#6dbd5a4e userId:int media:Document message:string = escrow.TransactionAttachment;

---functions---

---types---

---functions---

// share tx data
---types---

---functions---

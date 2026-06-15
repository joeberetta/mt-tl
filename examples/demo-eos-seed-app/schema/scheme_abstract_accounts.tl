---types---

/**
 * Изменение баланса кошелька
 *
 * @param	wallet_id	Id кошелька
 */
abstract.updateBalance#b7c18548 wallet_id:string = Update;

/**
 * Триггер для перезагрузки конфига абстрактных аккаунтов
 */
abstract.updateConfig#bc97276c = Update;

/**
 * Триггер для перезагрузки кошельков абстрактных аккаунтов
 */
abstract.updateWallets#7781b3c7 = Update;

/**
 * Медиа сообщения с транзакцией внешней сети
 *
 * @param	status	Статус транзакции
 * @param	from	Адрес отправителя
 * @param	to	Адрес получателя
 * @param	amount	Сумма транзакции
 * @param	tx_hash	Хеш транзакции (id транзакции в бч), появится после того как в бч появится транзакция
 * @param	from_user_id	ID связанного пользователя
 * @param	to_user_id	ID связанного пользователя
 * @param	is_abstract_address_related	Флаг связанного абстрактного адреса
 */
messageMediaExternalTransaction#e8de1d24 flags:# status:TransactionStatus from:string to:string amount:Amount tx_hash:flags.0?string from_user_id:flags.1?int to_user_id:flags.2?int is_abstract_address_related:flags.3?true = MessageMedia;

/**
 * Статус транзакции "выполнена"
 */
transactionStatusCompleted#bef976d1 = TransactionStatus;

/**
 * Статус транзакции "провалилась"
 */
transactionStatusFailed#b300ac0f = TransactionStatus;

/**
 * Статус транзакции "в обработке"
 */
transactionStatusPending#bf9fddcf = TransactionStatus;

/**
 * Изменение статуса транзакции
 *
 * @param	tx_hash	Id транзакции
 * @param	from_status	Статус транзакции до изменения
 * @param	to_status	Статус транзакции после изменения
 * @param	user_operation_hash	Хеш пользовательской операции внутри транзакции в бч (виден во вкладке Logs в эксплорере)
 */
updateTransactionStatusChanged#9d263c30 flags:# tx_hash:string from_status:TransactionStatus to_status:TransactionStatus user_operation_hash:flags.0?string = Update;

---functions---

/**
 * Получить статусы делегирования для адресов
 *
 * @param	wallet_id	Идентификатор кошелька
 */
abstract.getDelegationStatuses#a9d97f33 wallet_id:string = Vector<abstract.AddressDelegationStatus>;

/**
 * Получение дефолтных адресов пользователей
 *
 * @param	user_ids	Идентификаторы пользователей
 */
abstract.getUsersDefaultAddresses#042b66a3 user_ids:Vector<int> = Vector<abstract.DefaultAddresses>;

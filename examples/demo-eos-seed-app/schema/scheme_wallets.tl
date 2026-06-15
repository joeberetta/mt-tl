---types---

/**
 * Recent addresses action: add
 */
wallets.actionTypeAdd#0013d703 = wallets.RecentAddressesActionType;

/**
 * Recent addresses action: clear all
 */
wallets.actionTypeClearAll#35f268ce = wallets.RecentAddressesActionType;

/**
 * Recent addresses action: delete
 */
wallets.actionTypeDelete#5d556f48 = wallets.RecentAddressesActionType;

/**
 * Баланс кошелька
 *
 * @param	balances	Балансы по валютам
 * @param	cache_info	Информация о кэшировании
 */
wallets.balance#5d006cf1 balances:Vector<Amount> cache_info:CacheInfo = wallets.Balance;

/**
 * Баланс не изменен
 */
wallets.balanceNotModified#e679ad12 = wallets.Balance;

/**
 * Конфиг кошельков
 *
 * @param	base_currency	Базовая валюта, которая используется для отображения общего баланса и эквивалентов балансов
 * @param	currencies	Список валют
 * @param	networks	Список сетей
 * @param	cache_info	Информация о кэшировании
 * @param	rate_template_url	Шаблон ссылки на курс валюты
 * @param	is_readonly	Модуль кошелька отключен, можно просматривать балансы, но нельзя совершать операции
 * @param	metadata	Конфиг списка валют
 */
wallets.config#d3b2a02d flags:# base_currency:wallets.CurrencyInfo currencies:Vector<wallets.CurrencyInfo> networks:Vector<wallets.NetworkInfo> cache_info:CacheInfo rate_template_url:string is_readonly:flags.0?true metadata:flags.1?DataJSON = wallets.Config;

/**
 * Конфиг кошельков не изменен
 */
wallets.configNotModified#8e618d02 = wallets.Config;

/**
 * Список валют для модуля/фичи
 *
 * @param	id	ID списка валют
 * @param	currencies	Список валют
 * @param	cache_info	Информация о кэшировании
 * @param	is_readonly	Отключена для модуля/фичи, но при этом существует
 * @param	min	Минимальная сумма
 * @param	max	Максимальная сумма
 */
wallets.currenciesList#e9206c1c flags:# id:string currencies:Vector<Currency> cache_info:CacheInfo is_readonly:flags.0?true min:flags.1?Amount max:flags.2?Amount = wallets.CurrenciesList;

/**
 * Список валют не изменен
 */
wallets.currenciesListNotModified#687fe947 = wallets.CurrenciesList;

/**
 * Информация о валюте кошелька
 *
 * @param	currency	Валюта
 * @param	decimals	Количество десятичных знаков
 * @param	decimals_display	Количество десятичных знаков для отображения
 * @param	name_display	Отображаемое название
 * @param	icon_url	URL иконки
 * @param	is_readonly	
 * @param	is_memo_required	
 * @param	name_old	Старое название валюты (eos формат)
 * @param	network_standard	Стандарт сети валюты
 * @param	rate_ticker	Название валюты для стороннего провайдера курсов
 * @param	contract_address	Адрес контракта
 */
wallets.currencyInfo#87cbdb3e flags:# currency:Currency decimals:int decimals_display:int name_display:string icon_url:string is_readonly:flags.0?true is_memo_required:flags.1?true name_old:flags.2?string network_standard:flags.3?string rate_ticker:flags.4?string contract_address:flags.6?string = wallets.CurrencyInfo;

/**
 * Курс валюты
 *
 * @param	currency	Валюта
 * @param	price	Курс
 * @param	price24h	Курс за предыдущие сутки
 * @param	updated_at	Последняя дата обновления
 */
wallets.currencyRate#b67d56a3 currency:Currency price:string price24h:string updated_at:int = Wallets.CurrencyRate;

/**
 * Список курсов валют
 *
 * @param	rates	Курсы валют
 * @param	cache_info	Информация о кэшировании
 */
wallets.currencyRatesList#b92fa671 rates:Vector<Wallets.CurrencyRate> cache_info:CacheInfo = wallets.CurrencyRatesList;
wallets.currencyRatesListNotModified#4556cd74 = wallets.CurrencyRatesList;

/**
 * Информация о сети кошелька
 *
 * @param	id	ID сети
 * @param	name	Название сети
 * @param	icon_url	Ссылка на иконку
 * @param	explorer_url	Ссылка на обозреватель блоков
 * @param	chain_id	ID сети
 */
wallets.networkInfo#4f6c03b0 flags:# id:string name:string icon_url:string explorer_url:string chain_id:flags.0?int = wallets.NetworkInfo;

/**
 * Триггер для перезагрузки баланса кошельков
 */
wallets.updateBalance#591ee587 = Update;

/**
 * Триггер для перезагрузки конфига кошельков
 *
 * @param	id	ID списка для перезагрузки
 */
wallets.updateConfig#2ae14549 flags:# id:flags.0?string = Update;

/**
 * Триггер для перезагрузки списка валют по умолчанию
 */
wallets.updateCurrenciesList#fd154e05 = Update;

/**
 * Update: recent addresses changed
 *
 * @param	network_id	Network ID
 * @param	action_type	Changed action type: add, clear all or delete
 */
wallets.updateRecentAddresses#551bbeaa network_id:string action_type:wallets.RecentAddressesActionType = Update;

---functions---

/**
 * Получение баланса кошелька
 *
 * @param	hash	Хэш уникальности
 */
wallets.getBalance#5367a4b1 flags:# hash:flags.0?string = wallets.Balance;

/**
 * Получение конфигурации кошельков
 *
 * @param	hash	Хэш уникальности
 */
wallets.getConfig#7c08fb65 flags:# hash:flags.0?string = wallets.Config;

/**
 * Получение списка валют для модуля/фичи
 *
 * @param	currency_action_id	ID списка валют
 * @param	hash	Хэш уникальности
 */
wallets.getCurrenciesList#9cc115b1 flags:# currency_action_id:string hash:flags.0?string = wallets.CurrenciesList;

/**
 * Получение списка курсов валют
 *
 * @param	hash	Хэш уникальности
 */
wallets.getCurrencyRatesList#239ace1e flags:# hash:flags.0?string = wallets.CurrencyRatesList;

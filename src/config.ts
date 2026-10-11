import "dotenv/config";

type ConfigType={
    port:number,
    tgBotToken:string,
    telegramWebhookSecret:string,
    publicBaseUrl:string,
    tokenEncryptionKey:string,
    rabotaSubjectPatterns:string[],
    googleConsentMode:'testing'|'production',
    googleAuth:{
        clientId:string,
        secret:string,
        redirectUri:string,
        topicName:string,
    },
    database:{
        databaseUrl:string;
    }
}
type UnvalidatedConfigType= {
    port:unknown,
    tgBotToken:unknown,
    telegramWebhookSecret:unknown,
    publicBaseUrl:unknown,
    tokenEncryptionKey:unknown,
    rabotaSubjectPatterns:unknown,
    googleConsentMode:unknown,
    googleAuth:{
        clientId:unknown,
        secret:unknown,
        redirectUri:unknown,
        topicName:unknown
    },
    database:{
        databaseUrl:unknown;
    }
}
function createConfig():ConfigType{
    const config:UnvalidatedConfigType={
        port:process.env.PORT,
        tgBotToken:process.env.TG_BOT_TOKEN,
        telegramWebhookSecret:process.env.TELEGRAM_WEBHOOK_SECRET,
        tokenEncryptionKey:process.env.TOKEN_ENCRYPTION_KEY,
        rabotaSubjectPatterns:typeof process.env.RABOTA_SUBJECT_PATTERNS==='string'
            ? process.env.RABOTA_SUBJECT_PATTERNS.split(',').map((item)=>item.trim()).filter((item)=>item!=='')
            : [],
        googleConsentMode:process.env.GOOGLE_CONSENT_MODE??'testing',
        publicBaseUrl:typeof process.env.PUBLIC_BASE_URL==='string'
            ? process.env.PUBLIC_BASE_URL.replace(/\/+$/,'')
            : process.env.PUBLIC_BASE_URL,
        googleAuth:{
            clientId:process.env.GOOGLE_CLIENT_ID,
            secret:process.env.GOOGLE_CLIENT_SECRET,
            redirectUri:process.env.GOOGLE_REDIRECT_URI,
            topicName:process.env.GOOGLE_TOPIC_NAME,
        },
        database:{
            databaseUrl:process.env.DATABASE_URL
        }
    };
    if(!validateConfig(config))
        throw Error("unreachable");
    return{
        ...config,
        port:parseInt(config.port,10)
    };
}
type ValidatedConfigType=Omit<ConfigType,'port'> & {port:string};
// Throws listing every invalid variable; narrows for createConfig.
function validateConfig(config:UnvalidatedConfigType):config is ValidatedConfigType{
    const problems=configProblems(config);
    if(problems.length>0)
        throw Error(`Invalid configuration: ${problems.join(', ')}`);
    return true;
}
function configProblems(config:UnvalidatedConfigType):string[]{
    const problems:string[]=[];
    if(typeof config.port!=='string'||Number.isNaN(parseInt(config.port,10)))
        problems.push('PORT');
    if(typeof config.tgBotToken!=='string'||config.tgBotToken.trim()==="")
        problems.push('TG_BOT_TOKEN');
    if(typeof config.telegramWebhookSecret!=='string'||config.telegramWebhookSecret.trim()==="")
        problems.push('TELEGRAM_WEBHOOK_SECRET');
    if(typeof config.tokenEncryptionKey!=='string'||!/^[0-9a-fA-F]{64}$/.test(config.tokenEncryptionKey))
        problems.push('TOKEN_ENCRYPTION_KEY (must be 64 hex chars)');
    if(!Array.isArray(config.rabotaSubjectPatterns))
        problems.push('RABOTA_SUBJECT_PATTERNS');
    if(config.googleConsentMode!=='testing'&&config.googleConsentMode!=='production')
        problems.push('GOOGLE_CONSENT_MODE (testing|production)');
    if(typeof config.publicBaseUrl!=='string'||config.publicBaseUrl.trim()==="")
        problems.push('PUBLIC_BASE_URL');
    else{
        try{
            const parsed=new URL(config.publicBaseUrl);
            if(parsed.protocol!=='https:'&&parsed.protocol!=='http:')
                problems.push('PUBLIC_BASE_URL (http(s) only)');
            // A path-bearing base would break both fixed routes
            // (/telegram/webhook, /oauth/callback) - webhooks would 404 and the
            // OIDC audience would mismatch => total push outage.
            else if(parsed.pathname!=='/')
                problems.push('PUBLIC_BASE_URL (must not contain a path)');
        }catch{
            problems.push('PUBLIC_BASE_URL (invalid URL)');
        }
    }
    if(typeof config.googleAuth.clientId!=='string'||config.googleAuth.clientId.trim()==="")
        problems.push('GOOGLE_CLIENT_ID');
    if(typeof config.googleAuth.redirectUri!=='string'||config.googleAuth.redirectUri.trim()==="")
        problems.push('GOOGLE_REDIRECT_URI');
    if(typeof config.googleAuth.secret!=='string'||config.googleAuth.secret.trim()==="")
        problems.push('GOOGLE_CLIENT_SECRET');
    if(typeof config.googleAuth.topicName!=="string"||config.googleAuth.topicName.trim()==="")
        problems.push('GOOGLE_TOPIC_NAME');
    if(typeof config.database.databaseUrl!=="string"||config.database.databaseUrl.trim()==="")
        problems.push('DATABASE_URL');
    return problems;

}
export const EnvConfig=createConfig()
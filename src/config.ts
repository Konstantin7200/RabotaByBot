import "dotenv/config";

type ConfigType={
    port:number,
    tgBotToken:string,
    telegramWebhookSecret:string,
    publicBaseUrl:string,
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
type ValidatedConfigType={
    port:string,
    tgBotToken:string,
    telegramWebhookSecret:string,
    publicBaseUrl:string,
    googleAuth:{
        clientId:string,
        secret:string,
        redirectUri:string,
        topicName:string
    },
    database:{
        databaseUrl:string;
    }
}
function createConfig():ConfigType{
    const config:UnvalidatedConfigType={
        port:process.env.PORT,
        tgBotToken:process.env.TG_BOT_TOKEN,
        telegramWebhookSecret:process.env.TELEGRAM_WEBHOOK_SECRET,
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
    if(validateConfig(config))
    {
        const typedConfig:ConfigType={
            ...config,
            port:parseInt(config.port,10)
        }
        return typedConfig;
    }
    throw Error("Env doesnt contain nessesary variables");
}
function validateConfig(config:UnvalidatedConfigType):config is ValidatedConfigType{
    if(typeof config.port!=='string'||Number.isNaN(parseInt(config.port,10)))
        return false;
    if(typeof config.tgBotToken!=='string'||config.tgBotToken.trim()==="")
        return false;
    if(typeof config.telegramWebhookSecret!=='string'||config.telegramWebhookSecret.trim()==="")
        return false;
    if(typeof config.publicBaseUrl!=='string'||config.publicBaseUrl.trim()==="")
        return false;
    try{
        const parsed=new URL(config.publicBaseUrl);
        if(parsed.protocol!=='https:'&&parsed.protocol!=='http:')
            return false;
    }catch{
        return false;
    }
    if(typeof config.googleAuth.clientId!=='string'||config.googleAuth.clientId.trim()==="")
        return false;
    if(typeof config.googleAuth.redirectUri!=='string'||config.googleAuth.redirectUri.trim()==="")
        return false;
    if(typeof config.googleAuth.secret!=='string'||config.googleAuth.secret.trim()==="")
        return false;
    if(typeof config.googleAuth.topicName!=="string"||config.googleAuth.topicName.trim()==="")
        return false;
    if(typeof config.database.databaseUrl!=="string"||config.database.databaseUrl.trim()==="")
        return false;
    return true;

}
export const EnvConfig=createConfig()
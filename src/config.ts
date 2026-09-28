import "dotenv/config";

type ConfigType={
    port:number,
    tgBotToken:string,
    googleAuth:{
        clientId:string,
        secret:string,
        redirectUri:string
    }
}
type UnvalidatedConfigType= {
    port:unknown,
    tgBotToken:unknown,
    googleAuth:{
        clientId:unknown,
        secret:unknown,
        redirectUri:unknown
    }
}
type ValidatedConfigType={
    port:string,
    tgBotToken:string,
    googleAuth:{
        clientId:string,
        secret:string,
        redirectUri:string
    }
}
function createConfig():ConfigType{
    const config:UnvalidatedConfigType={
        port:process.env.PORT,
        tgBotToken:process.env.TG_BOT_TOKEN,
        googleAuth:{
            clientId:process.env.GOOGLE_CLIENT_ID,
            secret:process.env.GOOGLE_CLIENT_SECRET,
            redirectUri:process.env.GOOGLE_REDIRECT_URI
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
    if(typeof config.googleAuth.clientId!=='string'||config.googleAuth.clientId.trim()==="")
        return false;
    if(typeof config.googleAuth.redirectUri!=='string'||config.googleAuth.redirectUri.trim()==="")
        return false;
    if(typeof config.googleAuth.secret!=='string'||config.googleAuth.secret.trim()==="")
        return false;
    return true;

}
export const EnvConfig=createConfig()
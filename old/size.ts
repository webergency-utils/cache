const SIZE = 
{
    UNDEFINED           : 2,
    STRING              : 2,
    BOOLEAN             : 4,
    BYTES               : 4,
    NUMBER              : 8,
    Int8Array           : 1,
    Uint8Array          : 1,
    Uint8ClampedArray   : 1,
    Int16Array          : 2,
    Uint16Array         : 2,
    Int32Array          : 4,
    Uint32Array         : 4,
    Float32Array        : 4,
    Float64Array        : 8
}

function stringSize( str: string ): number
{
    return SIZE.STRING + 4 * Math.ceil( str.length / 4 );
}

function _sizeof( value: any, visited: Set<any> ): number
{
    let bytes = 0;

    switch( typeof value )
    {
        case 'object'   : 
        {
            if( value === null ){ bytes += SIZE.UNDEFINED } else
            if( value instanceof Int8Array ){ bytes += value.length * SIZE.Int8Array } else
            if( value instanceof Uint8Array ){ bytes += value.length * SIZE.Uint8Array } else
            if( value instanceof Uint8ClampedArray ){ bytes += value.length * SIZE.Uint8ClampedArray } else
            if( value instanceof Int16Array ){ bytes += value.length * SIZE.Int16Array } else
            if( value instanceof Uint16Array ){ bytes += value.length * SIZE.Uint16Array } else
            if( value instanceof Int32Array ){ bytes += value.length * SIZE.Int32Array } else
            if( value instanceof Uint32Array ){ bytes += value.length * SIZE.Uint32Array } else
            if( value instanceof Float32Array ){ bytes += value.length * SIZE.Float32Array } else
            if( value instanceof Float64Array ){ bytes += value.length * SIZE.Float64Array } else
            if( value instanceof Function ){ bytes += 0 } else
            if( value instanceof Date ){ bytes += stringSize( value.toISOString() ) } else
            if( value instanceof RegExp ){ bytes += stringSize( value.toString() ) } else
            if( Array.isArray( value )){ for( let v of value ){ bytes += _sizeof( v, visited )} break; } else
            if( value instanceof Set ){ for( let v of value.entries() ){ bytes += _sizeof( v, visited )} break; } else
            if( value instanceof Map ){ for( let [ k, v ] of value.entries() ){ bytes += _sizeof( k, visited ) + _sizeof( v, visited )} break; } else
            if( visited.has( value )){ break } else
            if( Array.isArray( value )) { for ( let v of value ){ bytes += _sizeof( v, visited )} }
            else
            {
                if( visited.has( value )){ break }
                visited.add( value );
                for( let key in value ){ bytes += stringSize( key ) + _sizeof( value[ key ], visited )}
            }
            break;
        }
        case 'string'   : bytes += SIZE.STRING + 4 * Math.ceil( value.length / 4 ); break;
        case 'number'   : bytes += SIZE.NUMBER; break;
        case 'undefined': bytes += SIZE.UNDEFINED; break;
        case 'boolean'  : bytes += SIZE.BOOLEAN; break;
        case 'symbol'   : bytes += ( value.toString().length - 8 ) * SIZE.STRING; break;
        case 'bigint'   : bytes += Buffer.from( value.toString()).byteLength; break;

        default         : bytes += 0; break;
    }
    
    return bytes;
}

export default function sizeof( value: any ): number
{
    return _sizeof( value, new Set());
}